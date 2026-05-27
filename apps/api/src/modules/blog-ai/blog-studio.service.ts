import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { LlmService } from '../../common/llm/llm.service';
import { UrlScraperService } from '../knowledge/url-scraper.service';
import { BLOG_ARTICLE_SYSTEM_PROMPT, BLOG_IDEATE_SYSTEM_PROMPT } from './blog-ai.prompts';

/**
 * Estúdio do Blog: system prompts editáveis (artigo/ideação) + base de
 * conhecimento (URLs/textos/imagens de referência). Tudo esparso — o código
 * continua sendo o default/fallback. Injetado na geração pelo BlogAiService.
 */

export type BlogPromptKey = 'article' | 'ideate';

export interface BlogPromptOverride {
  id: string;
  org_id: string;
  key: BlogPromptKey;
  prompt: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BlogKnowledgeSource {
  id: string;
  org_id: string;
  source_type: 'url' | 'text' | 'image';
  value: string;
  title: string | null;
  extracted_text: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const PROMPT_DEFAULTS: Record<BlogPromptKey, string> = {
  article: BLOG_ARTICLE_SYSTEM_PROMPT,
  ideate: BLOG_IDEATE_SYSTEM_PROMPT,
};

@Injectable()
export class BlogStudioService {
  private readonly log = new Logger(BlogStudioService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
    private readonly scraper: UrlScraperService,
  ) {}

  private get db() {
    return this.supabase.adminClient;
  }

  // ── Prompts editáveis ────────────────────────────────────────────────

  /** Lista os prompts (override quando existe, senão o default do código). */
  async listPrompts(orgId: string): Promise<Array<BlogPromptOverride & { is_default: boolean }>> {
    const { data } = await this.db.from('blog_prompt_overrides').select('*').eq('org_id', orgId);
    const overrides = (data ?? []) as BlogPromptOverride[];
    return (Object.keys(PROMPT_DEFAULTS) as BlogPromptKey[]).map((key) => {
      const o = overrides.find((r) => r.key === key);
      return o
        ? { ...o, is_default: false }
        : {
            id: '',
            org_id: orgId,
            key,
            prompt: PROMPT_DEFAULTS[key],
            is_active: true,
            created_at: '',
            updated_at: '',
            is_default: true,
          };
    });
  }

  async upsertPrompt(orgId: string, key: BlogPromptKey, prompt: string): Promise<BlogPromptOverride> {
    if (!PROMPT_DEFAULTS[key]) throw new BadRequestException(`key inválida: ${key}`);
    if (!prompt?.trim()) throw new BadRequestException('prompt obrigatório');
    const { data, error } = await this.db
      .from('blog_prompt_overrides')
      .upsert({ org_id: orgId, key, prompt: prompt.trim(), is_active: true }, { onConflict: 'org_id,key' })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as BlogPromptOverride;
  }

  /** Reset → volta pro default do código (remove o override). */
  async resetPrompt(orgId: string, key: BlogPromptKey): Promise<void> {
    const { error } = await this.db.from('blog_prompt_overrides').delete().eq('org_id', orgId).eq('key', key);
    if (error) throw new BadRequestException(error.message);
  }

  /** Resolve o system prompt: override ativo OU default do código. Best-effort. */
  async resolveSystemPrompt(orgId: string, key: BlogPromptKey): Promise<string> {
    try {
      const { data } = await this.db
        .from('blog_prompt_overrides')
        .select('prompt, is_active')
        .eq('org_id', orgId)
        .eq('key', key)
        .maybeSingle();
      const row = data as { prompt?: string; is_active?: boolean } | null;
      if (row?.is_active && row.prompt?.trim()) return row.prompt;
    } catch (e) {
      this.log.warn(`resolveSystemPrompt(${key}) fallback: ${(e as Error).message}`);
    }
    return PROMPT_DEFAULTS[key];
  }

  /** ✨ Melhora/reescreve um system prompt por IA a partir da intenção do usuário. */
  async generatePrompt(
    orgId: string,
    dto: { key: BlogPromptKey; instruction: string; current_prompt?: string },
  ): Promise<{ prompt: string }> {
    if (!dto.instruction?.trim()) throw new BadRequestException('instruction obrigatória');
    const what =
      dto.key === 'article'
        ? 'o SYSTEM PROMPT do redator de artigos de blog GEO-otimizados (que retorna JSON estruturado)'
        : 'o SYSTEM PROMPT do estrategista que sugere pautas de blog (que retorna JSON)';
    const system = `Você ajuda a escrever SYSTEM PROMPTS para uma IA de conteúdo de blog (GEO).
Reescreva ${what}, mantendo o CONTRATO DE SAÍDA (o mesmo schema JSON) intacto — só ajuste tom, foco e instruções editoriais conforme pedido.
Responda APENAS com o texto do system prompt — sem aspas, sem markdown, sem explicação.`;
    const user = [
      dto.current_prompt ? `PROMPT ATUAL:\n${dto.current_prompt}` : `PARTA DO PADRÃO:\n${PROMPT_DEFAULTS[dto.key]}`,
      `INTENÇÃO DO USUÁRIO: ${dto.instruction}`,
    ].join('\n\n');
    const out = await this.llm.chat({
      orgId,
      feature: 'blog_prompt_builder',
      system,
      user,
      max_tokens: 4000,
      temperature: 0.5,
    });
    return { prompt: (out.text ?? '').trim() };
  }

  // ── Base de conhecimento ─────────────────────────────────────────────

  async listKnowledge(orgId: string): Promise<BlogKnowledgeSource[]> {
    const { data } = await this.db
      .from('blog_knowledge_sources')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    return (data ?? []) as BlogKnowledgeSource[];
  }

  async addKnowledge(
    orgId: string,
    dto: { source_type: 'url' | 'text' | 'image'; value: string; title?: string },
  ): Promise<BlogKnowledgeSource> {
    if (!dto.value?.trim()) throw new BadRequestException('value obrigatório');
    let title = dto.title ?? null;
    let extracted: string | null = null;
    const meta: Record<string, unknown> = {};

    if (dto.source_type === 'url') {
      try {
        const scraped = await this.scraper.scrape(dto.value);
        title = title || scraped.title || hostnameOf(dto.value);
        extracted = (scraped.content || '').slice(0, 6000) || null;
      } catch (e) {
        this.log.warn(`scrape falhou (${dto.value}): ${(e as Error).message}`);
        title = title || hostnameOf(dto.value);
        meta.scrape_error = (e as Error).message?.slice(0, 200);
      }
    } else if (dto.source_type === 'text') {
      extracted = dto.value.trim().slice(0, 6000);
      title = title || 'Nota';
    }

    const { data, error } = await this.db
      .from('blog_knowledge_sources')
      .insert({
        org_id: orgId,
        source_type: dto.source_type,
        value: dto.value.trim(),
        title,
        extracted_text: extracted,
        metadata: meta,
      })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as BlogKnowledgeSource;
  }

  async removeKnowledge(orgId: string, id: string): Promise<void> {
    const { error } = await this.db.from('blog_knowledge_sources').delete().eq('org_id', orgId).eq('id', id);
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * Monta o bloco de conhecimento pra injetar no prompt de geração. Junta o
   * texto extraído (URLs/notas) das fontes ativas. Best-effort (vazio = sem
   * conhecimento). Imagens não entram no texto (referência visual futura).
   */
  async getKnowledgeBlock(orgId: string): Promise<string | undefined> {
    try {
      const { data } = await this.db
        .from('blog_knowledge_sources')
        .select('source_type, title, value, extracted_text')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .in('source_type', ['url', 'text']);
      const rows = (data ?? []) as Array<Pick<BlogKnowledgeSource, 'source_type' | 'title' | 'value' | 'extracted_text'>>;
      const parts = rows
        .map((r) => {
          const txt = (r.extracted_text || '').trim();
          if (!txt) return '';
          const head = r.source_type === 'url' ? `${r.title || 'Fonte'} (${r.value})` : r.title || 'Nota';
          return `### ${head}\n${txt.slice(0, 2500)}`;
        })
        .filter(Boolean);
      if (!parts.length) return undefined;
      // Limita o total injetado pra não estourar o contexto.
      return parts.join('\n\n').slice(0, 8000);
    } catch (e) {
      this.log.warn(`getKnowledgeBlock fallback: ${(e as Error).message}`);
      return undefined;
    }
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 40);
  }
}
