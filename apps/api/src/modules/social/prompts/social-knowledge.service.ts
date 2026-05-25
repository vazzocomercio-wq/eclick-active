import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { UrlScraperService } from '../../knowledge/url-scraper.service';

/**
 * Base de conhecimento do Social AI (Estúdio B2): imagens de referência +
 * URLs externas, escopadas por estilo/tipo (ou 'global'). URLs têm o texto
 * extraído via UrlScraperService pra injetar no prompt (B4).
 */

export interface KnowledgeSource {
  id: string;
  org_id: string;
  scope: string;
  source_type: 'image' | 'url';
  value: string;
  title: string | null;
  extracted_text: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class SocialKnowledgeService {
  private readonly log = new Logger(SocialKnowledgeService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly scraper: UrlScraperService,
  ) {}

  async list(orgId: string, scope?: string): Promise<KnowledgeSource[]> {
    let q = this.supabase.adminClient
      .from('social_knowledge_sources')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (scope) q = q.eq('scope', scope);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as KnowledgeSource[];
  }

  async add(
    orgId: string,
    dto: { scope?: string; source_type: 'image' | 'url'; value: string; title?: string },
  ): Promise<KnowledgeSource> {
    if (!dto.value?.trim()) throw new BadRequestException('value obrigatório');
    const scope = (dto.scope || 'global').trim();
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
    }

    const { data, error } = await this.supabase.adminClient
      .from('social_knowledge_sources')
      .insert({
        org_id: orgId,
        scope,
        source_type: dto.source_type,
        value: dto.value.trim(),
        title,
        extracted_text: extracted,
        metadata: meta,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as KnowledgeSource;
  }

  async remove(orgId: string, id: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('social_knowledge_sources')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw error;
  }

  /** Fontes aplicáveis a um escopo: as do escopo + as 'global'. (Usado no B4.) */
  async getForScope(orgId: string, scope: string): Promise<KnowledgeSource[]> {
    const { data } = await this.supabase.adminClient
      .from('social_knowledge_sources')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .in('scope', [scope, 'global']);
    return (data ?? []) as KnowledgeSource[];
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 40);
  }
}
