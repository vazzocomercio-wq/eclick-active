import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import type { SacResponseTemplate } from './sac.types';
import type { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';

/**
 * CRUD de templates de resposta SAC + interpolação de variáveis.
 * Variáveis suportadas: {{cliente.nome}}, {{pedido.numero}},
 * {{pedido.rastreio}}, {{pedido.prazo}}, {{pedido.valor}}.
 */
@Injectable()
export class SacTemplatesService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(
    orgId: string,
    category?: string,
  ): Promise<SacResponseTemplate[]> {
    let q = this.supabase.adminClient
      .from('sac_response_templates')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('usage_count', { ascending: false });
    if (category) q = q.eq('category', category);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as SacResponseTemplate[];
  }

  async create(
    orgId: string,
    actorId: string | null,
    dto: CreateTemplateDto,
  ): Promise<SacResponseTemplate> {
    const { data, error } = await this.supabase.adminClient
      .from('sac_response_templates')
      .insert({ ...dto, org_id: orgId, created_by: actorId })
      .select('*')
      .single();
    if (error) throw error;
    return data as SacResponseTemplate;
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateTemplateDto,
  ): Promise<SacResponseTemplate> {
    const { data, error } = await this.supabase.adminClient
      .from('sac_response_templates')
      .update(dto)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as SacResponseTemplate;
  }

  async delete(orgId: string, id: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('sac_response_templates')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);
    if (error) throw error;
  }

  /** Interpola variáveis no template. Vars não encontradas viram "—". */
  interpolate(content: string, ctx: Record<string, unknown>): string {
    return content.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
      const value = path
        .split('.')
        .reduce<unknown>(
          (acc, key) =>
            acc != null && typeof acc === 'object'
              ? (acc as Record<string, unknown>)[key]
              : undefined,
          ctx,
        );
      return value == null || value === '' ? '—' : String(value);
    });
  }

  async incrementUsage(orgId: string, id: string): Promise<void> {
    // Best-effort — não bloqueia.
    await this.supabase.adminClient.rpc('increment_template_usage', {
      p_id: id,
      p_org_id: orgId,
    }).then(({ error }) => {
      // Se a RPC não existe ainda, faz update manual
      if (error && error.code === '42883') {
        return this.supabase.adminClient
          .from('sac_response_templates')
          .select('usage_count')
          .eq('id', id)
          .eq('org_id', orgId)
          .single()
          .then(({ data }) => {
            const next = ((data as { usage_count?: number } | null)?.usage_count ?? 0) + 1;
            return this.supabase.adminClient
              .from('sac_response_templates')
              .update({ usage_count: next })
              .eq('id', id)
              .eq('org_id', orgId);
          });
      }
    });
  }
}
