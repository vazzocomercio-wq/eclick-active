import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { KnowledgeDocument } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { EmbeddingsClient } from './embeddings.client';
import { CreateDocumentDto, UpdateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents.query.dto';
import { UrlScraperService } from './url-scraper.service';
import type { PaginatedResult } from '../contacts/contacts.service';
import type { KnowledgeCategory } from '@eclick-active/shared';

/** Linha enxuta usada nas listas (sem `embedding` que é grande). */
export type KnowledgeDocumentListItem = Omit<KnowledgeDocument, 'embedding'>;

/** Resultado da busca semântica (vem do RPC com `similarity` injetada). */
export interface SemanticSearchHit {
  id: string;
  title: string;
  category: string;
  content: string;
  tokens: number | null;
  metadata: Record<string, unknown>;
  similarity: number;
}

/**
 * Lista os campos a SEMPRE selecionar nas queries — exclui `embedding`.
 * Em queries que precisam do embedding, use `select('*')` direto.
 */
const LIST_COLUMNS =
  'id, org_id, title, category, content, metadata, is_active, tokens, created_by, created_at, updated_at';

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly embeddings: EmbeddingsClient,
    private readonly scraper: UrlScraperService,
  ) {}

  // ────────────────────────────────────────────
  // URL IMPORT (preview / confirm / batch / refresh)
  // ────────────────────────────────────────────

  async previewUrl(
    rawUrl: string,
  ): Promise<{ title: string; content: string; url: string; char_count: number; token_estimate: number; truncated: boolean }> {
    return this.scraper.scrape(rawUrl);
  }

  async confirmUrlImport(
    orgId: string,
    args: { url: string; title: string; content: string; category?: KnowledgeCategory },
    createdBy: string | null,
  ): Promise<KnowledgeDocumentListItem> {
    const tokens = this.embeddings.estimateTokens(args.content);
    const embedding = await this.embeddings.embed(this.embedInput(args.title, args.content));

    const { data, error } = await this.supabase.adminClient
      .from('knowledge_documents')
      .insert({
        org_id: orgId,
        title: args.title,
        category: args.category ?? 'general',
        content: args.content,
        embedding,
        metadata: {},
        is_active: true,
        tokens,
        source_type: 'url',
        source_url: args.url,
        last_synced_at: new Date().toISOString(),
        auto_sync: false,
        created_by: createdBy,
      })
      .select(LIST_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`confirmUrlImport failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to import URL');
    }
    return data as KnowledgeDocumentListItem;
  }

  async batchPreview(
    urls: string[],
  ): Promise<Array<{ url: string; ok: boolean; title?: string; content?: string; char_count?: number; token_estimate?: number; truncated?: boolean; error?: string }>> {
    // Concurrency limit pra não estourar rate limits
    const concurrency = 3;
    const results: Array<{
      url: string;
      ok: boolean;
      title?: string;
      content?: string;
      char_count?: number;
      token_estimate?: number;
      truncated?: boolean;
      error?: string;
    }> = [];

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < urls.length) {
        const i = cursor++;
        const url = urls[i]!;
        try {
          const r = await this.scraper.scrape(url);
          results[i] = {
            url,
            ok: true,
            title: r.title,
            content: r.content,
            char_count: r.char_count,
            token_estimate: r.token_estimate,
            truncated: r.truncated,
          };
        } catch (err) {
          results[i] = {
            url,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return results;
  }

  async confirmBatchImport(
    orgId: string,
    items: Array<{ url: string; title: string; content: string }>,
    category: KnowledgeCategory | undefined,
    createdBy: string | null,
  ): Promise<KnowledgeDocumentListItem[]> {
    const out: KnowledgeDocumentListItem[] = [];
    for (const it of items) {
      try {
        const doc = await this.confirmUrlImport(
          orgId,
          { ...it, ...(category ? { category } : {}) },
          createdBy,
        );
        out.push(doc);
      } catch (err) {
        this.logger.warn(
          `batch import skipped ${it.url}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return out;
  }

  /**
   * Re-fetch URL e atualiza content + embedding se mudou. Marca
   * last_synced_at sempre. Funciona apenas pra source_type='url'.
   */
  async refreshUrlDocument(
    orgId: string,
    docId: string,
  ): Promise<{ updated: boolean; document: KnowledgeDocumentListItem }> {
    const { data: doc, error } = await this.supabase.adminClient
      .from('knowledge_documents')
      .select('id, source_type, source_url, title, content')
      .eq('org_id', orgId)
      .eq('id', docId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!doc) throw new NotFoundException(`Documento ${docId} não encontrado`);

    const row = doc as { id: string; source_type: string; source_url: string | null; title: string; content: string };
    if (row.source_type !== 'url' || !row.source_url) {
      throw new InternalServerErrorException('Documento não foi importado de URL — refresh não disponível');
    }

    const scraped = await this.scraper.scrape(row.source_url);
    const contentChanged = scraped.content !== row.content;
    const titleChanged = scraped.title !== row.title;

    const updates: Record<string, unknown> = {
      last_synced_at: new Date().toISOString(),
    };
    if (titleChanged) updates.title = scraped.title;
    if (contentChanged) {
      updates.content = scraped.content;
      updates.tokens = this.embeddings.estimateTokens(scraped.content);
      const embedding = await this.embeddings.embed(this.embedInput(scraped.title, scraped.content));
      if (embedding) updates.embedding = embedding;
    }

    const { data: updated, error: updErr } = await this.supabase.adminClient
      .from('knowledge_documents')
      .update(updates)
      .eq('org_id', orgId)
      .eq('id', docId)
      .select(LIST_COLUMNS)
      .single();
    if (updErr || !updated) {
      throw new InternalServerErrorException(updErr?.message ?? 'Failed to refresh document');
    }

    return {
      updated: contentChanged || titleChanged,
      document: updated as KnowledgeDocumentListItem,
    };
  }

  // ────────────────────────────────────────────
  // CREATE
  // ────────────────────────────────────────────

  async createDocument(
    orgId: string,
    dto: CreateDocumentDto,
    createdBy: string | null,
  ): Promise<KnowledgeDocumentListItem> {
    const tokens = this.embeddings.estimateTokens(dto.content);
    const embedding = await this.embeddings.embed(this.embedInput(dto.title, dto.content));

    const { data, error } = await this.supabase.adminClient
      .from('knowledge_documents')
      .insert({
        org_id: orgId,
        title: dto.title,
        category: dto.category ?? 'general',
        content: dto.content,
        embedding,
        metadata: dto.metadata ?? {},
        is_active: dto.is_active ?? true,
        tokens,
        created_by: createdBy,
      })
      .select(LIST_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`createDocument failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to create document',
      );
    }
    return data as KnowledgeDocumentListItem;
  }

  // ────────────────────────────────────────────
  // FIND ALL — paginado
  // ────────────────────────────────────────────

  async findAll(
    orgId: string,
    filters: ListDocumentsQueryDto,
  ): Promise<PaginatedResult<KnowledgeDocumentListItem>> {
    const page = filters.page;
    const limit = filters.limit;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let q = this.supabase.adminClient
      .from('knowledge_documents')
      .select(LIST_COLUMNS, { count: 'exact' })
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (filters.category) q = q.eq('category', filters.category);
    if (filters.is_active !== undefined) q = q.eq('is_active', filters.is_active);

    if (filters.search && filters.search.trim().length > 0) {
      const escaped = this.escapeIlike(filters.search.trim());
      q = q.or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`);
    }

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`findAll failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    return {
      data: (data ?? []) as KnowledgeDocumentListItem[],
      page,
      limit,
      total: count ?? 0,
    };
  }

  // ────────────────────────────────────────────
  // FIND BY ID
  // ────────────────────────────────────────────

  async findById(orgId: string, id: string): Promise<KnowledgeDocumentListItem> {
    const { data, error } = await this.supabase.adminClient
      .from('knowledge_documents')
      .select(LIST_COLUMNS)
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      this.logger.error(`findById failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    if (!data) throw new NotFoundException(`Document ${id} not found`);
    return data as KnowledgeDocumentListItem;
  }

  // ────────────────────────────────────────────
  // UPDATE — regenera embedding se content mudou
  // ────────────────────────────────────────────

  async update(
    orgId: string,
    id: string,
    dto: UpdateDocumentDto,
  ): Promise<KnowledgeDocumentListItem> {
    const existing = await this.findById(orgId, id);

    const patch: Record<string, unknown> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.is_active !== undefined) patch.is_active = dto.is_active;
    if (dto.metadata !== undefined) patch.metadata = dto.metadata;
    if (dto.content !== undefined) {
      patch.content = dto.content;
      patch.tokens = this.embeddings.estimateTokens(dto.content);
    }

    // Se o content mudou OU o título mudou (entra no embedding input), regenera
    const titleChanged = dto.title !== undefined && dto.title !== existing.title;
    const contentChanged = dto.content !== undefined && dto.content !== existing.content;
    if (titleChanged || contentChanged) {
      const nextTitle = dto.title ?? existing.title;
      const nextContent = dto.content ?? existing.content;
      patch.embedding = await this.embeddings.embed(
        this.embedInput(nextTitle, nextContent),
      );
    }

    const { data, error } = await this.supabase.adminClient
      .from('knowledge_documents')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select(LIST_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`update failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to update document',
      );
    }
    return data as KnowledgeDocumentListItem;
  }

  // ────────────────────────────────────────────
  // DELETE
  // ────────────────────────────────────────────

  async delete(orgId: string, id: string): Promise<void> {
    await this.findById(orgId, id);

    const { error } = await this.supabase.adminClient
      .from('knowledge_documents')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);

    if (error) {
      this.logger.error(`delete failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  // ────────────────────────────────────────────
  // SEARCH SEMANTIC — chamada via RPC do migration 007
  // ────────────────────────────────────────────

  async searchSemantic(
    orgId: string,
    query: string,
    limit = 5,
  ): Promise<SemanticSearchHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const queryEmbedding = await this.embeddings.embed(trimmed);
    if (!queryEmbedding) {
      this.logger.warn('Sem OPENAI_API_KEY — searchSemantic retorna vazio.');
      return [];
    }

    const { data, error } = await this.supabase.adminClient.rpc(
      'search_knowledge_semantic',
      {
        p_org_id: orgId,
        p_embedding: queryEmbedding,
        p_limit: limit,
        p_threshold: 0.0,
      },
    );

    if (error) {
      this.logger.error(`searchSemantic failed: ${error.message}`);
      // Não joga: a busca falhar não deve quebrar o caller (suggestResponse).
      return [];
    }

    return (data ?? []) as SemanticSearchHit[];
  }

  // ────────────────────────────────────────────
  // SEARCH WITH PRIORITY (skill-aware + intent boost) — Bloco F
  // ────────────────────────────────────────────

  async searchSemanticForSkill(
    orgId: string,
    query: string,
    args: {
      source_ids?: string[];
      categories?: string[];
      intent?: string | null;
    },
    limit = 5,
  ): Promise<SemanticSearchHit[]> {
    const hasSourceFilter = (args.source_ids?.length ?? 0) > 0;
    const hasCategoryFilter = (args.categories?.length ?? 0) > 0;
    const hasIntent = !!args.intent;

    if (!hasSourceFilter && !hasCategoryFilter && !hasIntent) {
      return this.searchSemantic(orgId, query, limit);
    }

    const candidates = await this.searchSemantic(orgId, query, Math.max(limit * 4, 20));
    if (candidates.length === 0) return [];

    let filtered = candidates;
    if (hasSourceFilter || hasCategoryFilter) {
      filtered = candidates.filter(
        (h) =>
          (args.source_ids?.includes(h.id) ?? false) ||
          (args.categories?.includes(h.category) ?? false),
      );
    }

    if (hasIntent && args.intent && filtered.length > 0) {
      const docIds = filtered.map((h) => h.id);
      const { data } = await this.supabase.adminClient
        .from('knowledge_documents')
        .select('id, priority_intents')
        .eq('org_id', orgId)
        .in('id', docIds);
      const priorityMap = new Map<string, string[]>();
      for (const row of (data ?? []) as Array<{ id: string; priority_intents: string[] }>) {
        priorityMap.set(row.id, row.priority_intents ?? []);
      }
      filtered.sort((a, b) => {
        const aPri = (priorityMap.get(a.id) ?? []).includes(args.intent!) ? 1 : 0;
        const bPri = (priorityMap.get(b.id) ?? []).includes(args.intent!) ? 1 : 0;
        if (aPri !== bPri) return bPri - aPri;
        return b.similarity - a.similarity;
      });
    }

    return filtered.slice(0, limit);
  }

  // ────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────

  /** Combina título + conteúdo no input do embedding pra melhorar matching. */
  private embedInput(title: string, content: string): string {
    return `${title}\n\n${content}`;
  }

  private escapeIlike(input: string): string {
    return input.replace(/[%_,()\\]/g, '');
  }
}
