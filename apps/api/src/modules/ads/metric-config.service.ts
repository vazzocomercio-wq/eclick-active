import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { OrgMemberRole } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { MetricCatalogService } from './metric-catalog.service';

export type ThresholdMode = 'manual' | 'auto';
export type AggregationWindow = 'day' | '7d' | '30d';

export interface AdMetricConfig {
  /** ID real (uuid) ou virtual:<metric_key> quando ainda não persistida. */
  id: string;
  metric_key: string;
  enabled: boolean;
  threshold_mode: ThresholdMode;
  target_value: number | null;
  warning_pct: number;
  critical_pct: number;
  baseline_window_days: number;
  aggregation_window: AggregationWindow;
  routing_manager_ids: string[];
  notes: string | null;
  /** Catalog metadata anexado pra UI não precisar de duas chamadas. */
  catalog: {
    display_name: string;
    description: string;
    data_type: string;
    direction: string;
    aggregation: string;
    unit: string;
    category: string;
    platform: string;
    is_core: boolean;
  };
  /** Indica se a row é virtual (default ainda não persistida). */
  virtual: boolean;
  updated_at: string | null;
}

interface ConfigPatch {
  enabled?: boolean;
  threshold_mode?: ThresholdMode;
  target_value?: number | null;
  warning_pct?: number;
  critical_pct?: number;
  baseline_window_days?: number;
  aggregation_window?: AggregationWindow;
  routing_manager_ids?: string[];
  notes?: string | null;
}

/**
 * Defaults sugeridos pra cada métrica core. Virtual quando o user ainda
 * não personalizou — UI exibe os valores e qualquer PATCH persiste a
 * row real (vira não-virtual).
 *
 * Filosofia dos defaults:
 *   - core métricas vêm enabled=true, threshold_mode='manual' SEM
 *     target_value (user define no primeiro patch).
 *   - non-core vêm enabled=false (opt-in).
 *   - warning/critical sempre 15%/30% — bons defaults universais.
 */
const DEFAULT_PATCH_FOR_CORE: ConfigPatch = {
  enabled: true,
  threshold_mode: 'manual',
  warning_pct: 15,
  critical_pct: 30,
  baseline_window_days: 30,
  aggregation_window: 'day',
};

const DEFAULT_PATCH_FOR_NON_CORE: ConfigPatch = {
  enabled: false,
  threshold_mode: 'manual',
  warning_pct: 15,
  critical_pct: 30,
  baseline_window_days: 30,
  aggregation_window: 'day',
};

@Injectable()
export class MetricConfigService {
  private readonly logger = new Logger(MetricConfigService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly catalog: MetricCatalogService,
  ) {}

  /**
   * Lista TODAS as configs pra org — mescla rows persistidas com
   * defaults virtuais pras métricas que ainda não foram tocadas.
   * Filtra por plataforma se especificada.
   */
  async list(
    orgId: string,
    platform?: 'meta' | 'google' | 'shared' | 'all',
  ): Promise<AdMetricConfig[]> {
    const catalogEntries = await this.catalog.list(platform ?? 'all');

    const { data, error } = await this.supabase.adminClient
      .from('ad_metric_configs')
      .select(
        'id, metric_key, enabled, threshold_mode, target_value, warning_pct, critical_pct, baseline_window_days, aggregation_window, routing_manager_ids, notes, updated_at',
      )
      .eq('org_id', orgId);

    if (error) {
      this.logger.error(`list configs falhou: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    const persisted = new Map<string, NonNullable<typeof data>[number]>();
    for (const row of (data ?? []) as NonNullable<typeof data>) {
      persisted.set(row.metric_key as string, row);
    }

    return catalogEntries.map((cat) => {
      const row = persisted.get(cat.key);
      if (row) {
        return {
          id: row.id as string,
          metric_key: cat.key,
          enabled: row.enabled as boolean,
          threshold_mode: row.threshold_mode as ThresholdMode,
          target_value: row.target_value as number | null,
          warning_pct: Number(row.warning_pct),
          critical_pct: Number(row.critical_pct),
          baseline_window_days: row.baseline_window_days as number,
          aggregation_window: row.aggregation_window as AggregationWindow,
          routing_manager_ids: (row.routing_manager_ids as string[]) ?? [],
          notes: (row.notes as string | null) ?? null,
          catalog: pickCatalog(cat),
          virtual: false,
          updated_at: row.updated_at as string,
        };
      }
      // Virtual default
      const defaults = cat.is_core ? DEFAULT_PATCH_FOR_CORE : DEFAULT_PATCH_FOR_NON_CORE;
      return {
        id: `virtual:${cat.key}`,
        metric_key: cat.key,
        enabled: defaults.enabled ?? true,
        threshold_mode: defaults.threshold_mode ?? 'manual',
        target_value: defaults.target_value ?? null,
        warning_pct: defaults.warning_pct ?? 15,
        critical_pct: defaults.critical_pct ?? 30,
        baseline_window_days: defaults.baseline_window_days ?? 30,
        aggregation_window: defaults.aggregation_window ?? 'day',
        routing_manager_ids: defaults.routing_manager_ids ?? [],
        notes: defaults.notes ?? null,
        catalog: pickCatalog(cat),
        virtual: true,
        updated_at: null,
      };
    });
  }

  /**
   * Patch — upsert da config pra (org, metric). Permissão owner/admin.
   * Valida bounds (pcts 0-200, baseline_window 1-365).
   */
  async upsert(
    orgId: string,
    actorRole: OrgMemberRole,
    metricKey: string,
    patch: ConfigPatch,
  ): Promise<AdMetricConfig> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException(
        'Apenas owner/admin podem alterar configs de métrica.',
      );
    }

    const cat = await this.catalog.get(metricKey);
    if (!cat) {
      throw new NotFoundException(`Métrica "${metricKey}" não está no catálogo.`);
    }

    this.validatePatch(patch);

    // Lê o que tem (se houver) pra preservar campos não-tocados
    const { data: existing } = await this.supabase.adminClient
      .from('ad_metric_configs')
      .select('*')
      .eq('org_id', orgId)
      .eq('metric_key', metricKey)
      .maybeSingle();

    const baseline =
      (existing as Record<string, unknown> | null) ??
      (cat.is_core ? DEFAULT_PATCH_FOR_CORE : DEFAULT_PATCH_FOR_NON_CORE);

    const merged = {
      org_id: orgId,
      metric_key: metricKey,
      enabled: patch.enabled ?? (baseline as ConfigPatch).enabled ?? true,
      threshold_mode: patch.threshold_mode ?? (baseline as ConfigPatch).threshold_mode ?? 'manual',
      target_value:
        patch.target_value !== undefined
          ? patch.target_value
          : (baseline as ConfigPatch).target_value ?? null,
      warning_pct: patch.warning_pct ?? (baseline as ConfigPatch).warning_pct ?? 15,
      critical_pct: patch.critical_pct ?? (baseline as ConfigPatch).critical_pct ?? 30,
      baseline_window_days:
        patch.baseline_window_days ?? (baseline as ConfigPatch).baseline_window_days ?? 30,
      aggregation_window:
        patch.aggregation_window ?? (baseline as ConfigPatch).aggregation_window ?? 'day',
      routing_manager_ids:
        patch.routing_manager_ids ?? (baseline as ConfigPatch).routing_manager_ids ?? [],
      notes: patch.notes !== undefined ? patch.notes : (baseline as ConfigPatch).notes ?? null,
    };

    const { data, error } = await this.supabase.adminClient
      .from('ad_metric_configs')
      .upsert(merged, { onConflict: 'org_id,metric_key' })
      .select(
        'id, metric_key, enabled, threshold_mode, target_value, warning_pct, critical_pct, baseline_window_days, aggregation_window, routing_manager_ids, notes, updated_at',
      )
      .single();

    if (error || !data) {
      this.logger.error(`upsert config falhou: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Falha ao salvar config');
    }

    const row = data as Record<string, unknown>;
    return {
      id: row.id as string,
      metric_key: metricKey,
      enabled: row.enabled as boolean,
      threshold_mode: row.threshold_mode as ThresholdMode,
      target_value: row.target_value as number | null,
      warning_pct: Number(row.warning_pct),
      critical_pct: Number(row.critical_pct),
      baseline_window_days: row.baseline_window_days as number,
      aggregation_window: row.aggregation_window as AggregationWindow,
      routing_manager_ids: (row.routing_manager_ids as string[]) ?? [],
      notes: (row.notes as string | null) ?? null,
      catalog: pickCatalog(cat),
      virtual: false,
      updated_at: row.updated_at as string,
    };
  }

  private validatePatch(patch: ConfigPatch): void {
    if (
      patch.warning_pct !== undefined &&
      (patch.warning_pct < 0 || patch.warning_pct > 200)
    ) {
      throw new BadRequestException('warning_pct deve estar entre 0 e 200');
    }
    if (
      patch.critical_pct !== undefined &&
      (patch.critical_pct < 0 || patch.critical_pct > 200)
    ) {
      throw new BadRequestException('critical_pct deve estar entre 0 e 200');
    }
    if (
      patch.warning_pct !== undefined &&
      patch.critical_pct !== undefined &&
      patch.critical_pct < patch.warning_pct
    ) {
      throw new BadRequestException('critical_pct precisa ser >= warning_pct');
    }
    if (
      patch.baseline_window_days !== undefined &&
      (patch.baseline_window_days < 1 || patch.baseline_window_days > 365)
    ) {
      throw new BadRequestException('baseline_window_days deve estar entre 1 e 365');
    }
  }
}

function pickCatalog(cat: {
  display_name: string;
  description: string;
  data_type: string;
  direction: string;
  aggregation: string;
  unit: string;
  category: string;
  platform: string;
  is_core: boolean;
}): AdMetricConfig['catalog'] {
  return {
    display_name: cat.display_name,
    description: cat.description,
    data_type: cat.data_type,
    direction: cat.direction,
    aggregation: cat.aggregation,
    unit: cat.unit,
    category: cat.category,
    platform: cat.platform,
    is_core: cat.is_core,
  };
}
