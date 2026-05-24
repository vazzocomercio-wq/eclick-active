import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { KnowledgeLiveSource } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { UrlScraperService } from './url-scraper.service';
import { EmbeddingsClient } from './embeddings.client';
import { CreateLiveSourceDto, UpdateLiveSourceDto } from './dto/live-source.dto';

interface CacheEntry {
  content: string;
  hash: string;
  fetched_at: number; // epoch ms
}

interface RateBucket {
  count: number;
  windowStart: number;
}

const RATE_LIMIT_MAX_PER_MIN = 5;
const FETCH_TIMEOUT_FALLBACK_MS = 8_000;
const MIN_DESCRIPTION_SIM = 0.55; // cosine sim mínima entre query e description
const MAX_SOURCES_PER_QUERY = 3; // não consultar todas em cada turn

/**
 * Gerencia "fontes live" — URLs cadastradas que a IA consulta em tempo
 * real quando precisa de dados atualizados.
 *
 * Cache em memória (Map por org+source_id, TTL configurável). Rate limit
 * de 5 fetches/min por org. Não usa Redis — quando rodar em cluster, cada
 * instância tem seu próprio cache (aceitável: pior caso é fetch duplicado).
 */
@Injectable()
export class LiveSourcesService {
  private readonly logger = new Logger(LiveSourcesService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly rateBuckets = new Map<string, RateBucket>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly scraper: UrlScraperService,
    private readonly embeddings: EmbeddingsClient,
  ) {}

  // ────────────────────────────────────────────
  // CRUD
  // ────────────────────────────────────────────

  async list(orgId: string): Promise<KnowledgeLiveSource[]> {
    const { data, error } = await this.supabase.adminClient
      .from('knowledge_live_sources')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as KnowledgeLiveSource[];
  }

  async create(orgId: string, dto: CreateLiveSourceDto): Promise<KnowledgeLiveSource> {
    // Valida URL com scraper (mesma proteção SSRF)
    this.scraper.validateUrl(dto.url);

    const { data, error } = await this.supabase.adminClient
      .from('knowledge_live_sources')
      .insert({
        org_id: orgId,
        name: dto.name,
        url: dto.url,
        description: dto.description ?? null,
        source_type: dto.source_type ?? 'webpage',
        cache_ttl_minutes: dto.cache_ttl_minutes ?? 60,
        is_active: dto.is_active ?? true,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao criar fonte live');
    }
    return data as KnowledgeLiveSource;
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateLiveSourceDto,
  ): Promise<KnowledgeLiveSource> {
    const existing = await this.findById(orgId, id);
    if (dto.url) this.scraper.validateUrl(dto.url);

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.url !== undefined) patch.url = dto.url;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.source_type !== undefined) patch.source_type = dto.source_type;
    if (dto.cache_ttl_minutes !== undefined) patch.cache_ttl_minutes = dto.cache_ttl_minutes;
    if (dto.is_active !== undefined) patch.is_active = dto.is_active;

    // Invalida cache se URL mudou
    if (dto.url && dto.url !== existing.url) {
      this.cache.delete(this.cacheKey(orgId, id));
    }

    const { data, error } = await this.supabase.adminClient
      .from('knowledge_live_sources')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao atualizar fonte live');
    }
    return data as KnowledgeLiveSource;
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.findById(orgId, id);
    this.cache.delete(this.cacheKey(orgId, id));
    const { error } = await this.supabase.adminClient
      .from('knowledge_live_sources')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);
  }

  async findById(orgId: string, id: string): Promise<KnowledgeLiveSource> {
    const { data, error } = await this.supabase.adminClient
      .from('knowledge_live_sources')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Fonte live ${id} não encontrada`);
    return data as KnowledgeLiveSource;
  }

  /**
   * Testa uma fonte (já criada): força refetch e retorna preview do conteúdo.
   * Usado pelo botão "Testar" na UI.
   */
  async test(
    orgId: string,
    id: string,
  ): Promise<{ ok: boolean; content?: string; char_count?: number; error?: string }> {
    const source = await this.findById(orgId, id);
    if (!this.checkRateLimit(orgId)) {
      return { ok: false, error: 'Rate limit atingido (5 fetches/min). Aguarde um momento.' };
    }
    try {
      const fetched = await this.fetchOne(source);
      return { ok: true, content: fetched.content.slice(0, 5000), char_count: fetched.content.length };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ────────────────────────────────────────────
  // Consulta agregada — chamada por ai.service quando KB local insuficiente
  // ────────────────────────────────────────────

  /**
   * Para um query do usuário, decide quais fontes live são relevantes
   * (via similaridade entre query e description), busca o conteúdo
   * (cacheado ou fresh) e retorna concatenado pra injetar no prompt.
   *
   * Retorna `null` se não houver fontes ativas ou rate limit estourou.
   */
  async fetchLiveContent(
    orgId: string,
    query: string,
  ): Promise<{ content: string; sources_used: Array<{ id: string; name: string; url: string }> } | null> {
    const trimmed = query.trim();
    if (!trimmed) return null;

    const { data, error } = await this.supabase.adminClient
      .from('knowledge_live_sources')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true);
    if (error) {
      this.logger.warn(`fetchLiveContent list failed: ${error.message}`);
      return null;
    }
    const sources = (data ?? []) as KnowledgeLiveSource[];
    if (sources.length === 0) return null;

    // Decide quais fontes são relevantes via similaridade entre query e
    // description. Sem OPENAI_API_KEY, cai pra "todas as ativas" limitadas
    // por MAX_SOURCES_PER_QUERY.
    const queryEmbedding = await this.embeddings.embed(trimmed, orgId).catch(() => null);
    let relevant: KnowledgeLiveSource[];
    if (queryEmbedding) {
      const scored = await Promise.all(
        sources.map(async (s) => {
          const desc = (s.description ?? s.name).trim();
          if (!desc) return { source: s, score: 0 };
          const descEmb = await this.embeddings.embed(desc, orgId).catch(() => null);
          if (!descEmb) return { source: s, score: 0 };
          return { source: s, score: cosineSim(queryEmbedding, descEmb) };
        }),
      );
      relevant = scored
        .filter((r) => r.score >= MIN_DESCRIPTION_SIM)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_SOURCES_PER_QUERY)
        .map((r) => r.source);
      // Se nenhuma passou no threshold, usa as 2 mais bem ranqueadas (graceful)
      if (relevant.length === 0 && scored.length > 0) {
        relevant = scored
          .sort((a, b) => b.score - a.score)
          .slice(0, Math.min(2, scored.length))
          .map((r) => r.source);
      }
    } else {
      relevant = sources.slice(0, MAX_SOURCES_PER_QUERY);
    }

    if (relevant.length === 0) return null;

    // Fetch (cache ou fresh) — em paralelo, mas respeitando rate limit
    const fetched: Array<{ source: KnowledgeLiveSource; content: string }> = [];
    for (const s of relevant) {
      const cached = this.getCached(orgId, s);
      if (cached) {
        fetched.push({ source: s, content: cached });
        continue;
      }
      if (!this.checkRateLimit(orgId)) {
        this.logger.warn(`Rate limit hit pra org ${orgId} — pulando fontes restantes`);
        break;
      }
      try {
        const r = await this.fetchOne(s);
        fetched.push({ source: s, content: r.content });
      } catch (err) {
        this.logger.warn(
          `fetchOne failed pra ${s.url}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (fetched.length === 0) return null;

    const content = fetched
      .map((f) => `### Fonte: ${f.source.name} (${f.source.url})\n${f.content}`)
      .join('\n\n---\n\n');

    return {
      content,
      sources_used: fetched.map((f) => ({ id: f.source.id, name: f.source.name, url: f.source.url })),
    };
  }

  // ────────────────────────────────────────────
  // Fetch individual + cache
  // ────────────────────────────────────────────

  private getCached(orgId: string, source: KnowledgeLiveSource): string | null {
    const key = this.cacheKey(orgId, source.id);
    const entry = this.cache.get(key);
    if (!entry) return null;
    const ttlMs = source.cache_ttl_minutes * 60 * 1000;
    if (Date.now() - entry.fetched_at > ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.content;
  }

  private async fetchOne(
    source: KnowledgeLiveSource,
  ): Promise<{ content: string; hash: string }> {
    // Roadmap de fetchers (atual: só HTML scraper):
    //   - webpage        → UrlScraperService (HTML + URLs)         ✓ implementado
    //   - api_endpoint   → JSON / GraphQL (ML, Instagram, WPP Catalog, TikTok Shop, Meta Commerce, e-Click SaaS)  TODO
    //   - rss_feed       → parser RSS                               TODO
    //
    // Quando adicionar integrações (ML API, Instagram Graph, etc.), criar
    // pasta `fetchers/` com uma classe por integração implementando
    // `fetch(source): Promise<{ content; products?: StructuredProduct[] }>`,
    // e ramificar aqui por source_type ou por host pattern (URL contém
    // mercadolivre.com.br → MercadoLivreFetcher, etc.).
    const scraped = await Promise.race([
      this.scraper.scrape(source.url),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout 8s ao consultar fonte live')), FETCH_TIMEOUT_FALLBACK_MS),
      ),
    ]);
    const trimmed = scraped.content.length > 12_000 ? scraped.content.slice(0, 12_000) + '\n[…truncado pra cache live]' : scraped.content;
    const hash = createHash('sha256').update(trimmed).digest('hex');

    // Cache em memória
    this.cache.set(this.cacheKey(source.org_id, source.id), {
      content: trimmed,
      hash,
      fetched_at: Date.now(),
    });

    // Persiste last_fetched_at + last_content_hash (best-effort, sem await)
    void this.supabase.adminClient
      .from('knowledge_live_sources')
      .update({
        last_fetched_at: new Date().toISOString(),
        last_content_hash: hash,
      })
      .eq('org_id', source.org_id)
      .eq('id', source.id)
      .then(() => {})
      .then(undefined, () => {});

    return { content: trimmed, hash };
  }

  // ────────────────────────────────────────────
  // Rate limit (5 fetches/min/org)
  // ────────────────────────────────────────────

  private checkRateLimit(orgId: string): boolean {
    const now = Date.now();
    const bucket = this.rateBuckets.get(orgId);
    const windowMs = 60_000;
    if (!bucket || now - bucket.windowStart > windowMs) {
      this.rateBuckets.set(orgId, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= RATE_LIMIT_MAX_PER_MIN) return false;
    bucket.count += 1;
    return true;
  }

  private cacheKey(orgId: string, sourceId: string): string {
    return `${orgId}::${sourceId}`;
  }
}

// ────────────────────────────────────────────
// math
// ────────────────────────────────────────────

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
