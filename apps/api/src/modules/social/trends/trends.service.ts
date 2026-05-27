import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type {
  CreateMonitorDto,
  TrendBrief,
  TrendItem,
  TrendItemFilters,
  TrendMonitor,
  TrendNetwork,
  TrendSignal,
  TrendSourceStatus,
  TrendsOverview,
  UpdateMonitorDto,
} from './trends.types';

const NETWORKS: TrendNetwork[] = [
  'youtube',
  'meta_ads',
  'tiktok',
  'google_trends',
  'instagram',
];

/** Catálogo de fontes: rótulo + fase em que o conector entra + nota honesta. */
const SOURCE_CATALOG: Array<{
  source: TrendNetwork;
  label: string;
  phase: string;
  note: string;
}> = [
  {
    source: 'youtube',
    label: 'YouTube',
    phase: 'TR-1',
    note: 'Vídeos mais populares por categoria/região (YouTube Data API — oficial).',
  },
  {
    source: 'google_trends',
    label: 'Google Trends',
    phase: 'TR-1',
    note: 'Termos em ascensão por categoria/região (beta/não-oficial).',
  },
  {
    source: 'meta_ads',
    label: 'Meta Ad Library',
    phase: 'TR-2',
    note: 'Criativos ativos de concorrentes (Ad Library API — oficial). Reusa o app Meta.',
  },
  {
    source: 'instagram',
    label: 'Instagram (hashtags)',
    phase: 'TR-2',
    note: 'Hashtag search da Graph API (limitado: 30 hashtags / 7 dias).',
  },
  {
    source: 'tiktok',
    label: 'TikTok Creative Center',
    phase: 'TR-5',
    note: 'Sons/hashtags/vídeos em alta por categoria (API gated — requer aprovação).',
  },
];

/**
 * Radar de Conteúdo — service de fundação (TR-0).
 * CRUD de monitores + leitura de itens/sinais/briefs (vazios até os conectores
 * de TR-1/TR-2/TR-5 popularem trend_items). Tudo escopo por org via RLS, mas o
 * adminClient ignora RLS → SEMPRE filtra org_id explicitamente (defesa em profundidade).
 */
@Injectable()
export class TrendsService {
  private readonly log = new Logger(TrendsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ─── Monitores ──────────────────────────────────

  async listMonitors(orgId: string): Promise<TrendMonitor[]> {
    const { data, error } = await this.supabase.adminClient
      .from('trend_monitors')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as TrendMonitor[];
  }

  async createMonitor(
    orgId: string,
    dto: CreateMonitorDto,
  ): Promise<TrendMonitor> {
    const network = dto.network;
    const category = dto.category?.trim();
    if (!network || !NETWORKS.includes(network)) {
      throw new BadRequestException('network inválida');
    }
    if (!category) {
      throw new BadRequestException('category é obrigatória');
    }
    const row = {
      org_id: orgId,
      brand_id: dto.brand_id ?? null,
      network,
      category,
      keywords: (dto.keywords ?? []).map((k) => k.trim()).filter(Boolean),
      competitors: dto.competitors ?? [],
      region: dto.region?.trim() || 'BR',
      language: dto.language?.trim() || 'pt',
      config: dto.config ?? {},
    };
    const { data, error } = await this.supabase.adminClient
      .from('trend_monitors')
      .insert(row)
      .select('*')
      .single();
    if (error) throw error;
    return data as TrendMonitor;
  }

  async updateMonitor(
    orgId: string,
    id: string,
    dto: UpdateMonitorDto,
  ): Promise<TrendMonitor> {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.category != null) patch.category = dto.category.trim();
    if (dto.keywords != null)
      patch.keywords = dto.keywords.map((k) => k.trim()).filter(Boolean);
    if (dto.competitors != null) patch.competitors = dto.competitors;
    if (dto.region != null) patch.region = dto.region.trim() || 'BR';
    if (dto.language != null) patch.language = dto.language.trim() || 'pt';
    if (dto.is_active != null) patch.is_active = dto.is_active;
    if (dto.config != null) patch.config = dto.config;

    const { data, error } = await this.supabase.adminClient
      .from('trend_monitors')
      .update(patch)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Monitor não encontrado');
    return data as TrendMonitor;
  }

  async deleteMonitor(orgId: string, id: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('trend_monitors')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);
    if (error) throw error;
  }

  // ─── Itens / Sinais / Briefs (leitura) ──────────

  async listItems(orgId: string, f: TrendItemFilters = {}): Promise<TrendItem[]> {
    let q = this.supabase.adminClient
      .from('trend_items')
      .select('*')
      .eq('org_id', orgId)
      .order('score', { ascending: false })
      .order('collected_at', { ascending: false })
      .limit(Math.min(f.limit ?? 60, 200));
    if (f.source) q = q.eq('source', f.source);
    if (f.category) q = q.eq('category', f.category);
    if (f.kind) q = q.eq('kind', f.kind);
    if (f.monitor_id) q = q.eq('monitor_id', f.monitor_id);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as TrendItem[];
  }

  async getItem(orgId: string, id: string): Promise<TrendItem> {
    const { data, error } = await this.supabase.adminClient
      .from('trend_items')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Item não encontrado');
    return data as TrendItem;
  }

  async listSignals(orgId: string, limit = 40): Promise<TrendSignal[]> {
    const { data, error } = await this.supabase.adminClient
      .from('trend_signals')
      .select('*')
      .eq('org_id', orgId)
      .is('dismissed_at', null)
      .order('score', { ascending: false })
      .order('detected_at', { ascending: false })
      .limit(Math.min(limit, 100));
    if (error) throw error;
    return (data ?? []) as TrendSignal[];
  }

  async listBriefs(orgId: string, limit = 40): Promise<TrendBrief[]> {
    const { data, error } = await this.supabase.adminClient
      .from('trend_briefs')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 100));
    if (error) throw error;
    return (data ?? []) as TrendBrief[];
  }

  // ─── Overview (estado do Radar) ─────────────────

  async getOverview(orgId: string): Promise<TrendsOverview> {
    const [monitors, itemsAgg, signals, briefs] = await Promise.all([
      this.listMonitors(orgId),
      this.itemsAggregateBySource(orgId),
      this.countTable('trend_signals', orgId),
      this.countTable('trend_briefs', orgId),
    ]);

    const categories = [...new Set(monitors.map((m) => m.category))].sort();
    const totalItems = [...itemsAgg.values()].reduce((s, v) => s + v.count, 0);

    const by_source: TrendSourceStatus[] = SOURCE_CATALOG.map((c) => {
      const agg = itemsAgg.get(c.source);
      return {
        source: c.source,
        label: c.label,
        status: agg && agg.count > 0 ? 'live' : 'planned',
        phase: c.phase,
        note: c.note,
        items: agg?.count ?? 0,
        last_collected_at: agg?.last ?? null,
      };
    });

    return {
      monitors: monitors.length,
      active_monitors: monitors.filter((m) => m.is_active).length,
      items: totalItems,
      signals,
      briefs,
      categories,
      by_source,
      generated_at: new Date().toISOString(),
    };
  }

  private async itemsAggregateBySource(
    orgId: string,
  ): Promise<Map<TrendNetwork, { count: number; last: string | null }>> {
    const out = new Map<TrendNetwork, { count: number; last: string | null }>();
    const { data, error } = await this.supabase.adminClient
      .from('trend_items')
      .select('source, collected_at')
      .eq('org_id', orgId)
      .order('collected_at', { ascending: false })
      .limit(5000);
    if (error) throw error;
    for (const r of (data ?? []) as Array<{ source: TrendNetwork; collected_at: string }>) {
      const cur = out.get(r.source) ?? { count: 0, last: null };
      cur.count += 1;
      if (!cur.last) cur.last = r.collected_at; // primeira = mais recente (ordenado desc)
      out.set(r.source, cur);
    }
    return out;
  }

  private async countTable(table: string, orgId: string): Promise<number> {
    const { count, error } = await this.supabase.adminClient
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId);
    if (error) {
      this.log.warn(`count ${table} falhou: ${(error as Error).message}`);
      return 0;
    }
    return count ?? 0;
  }
}
