import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { MetricConfigService, AdMetricConfig } from '../metric-config.service';

/**
 * MetricCoverage — audit estático + dinâmico pra detectar configs órfãs.
 *
 * Problema sem audit: usuário liga `enabled=true` numa métrica que o
 * `extractMetricValue()` do SignalDetector não consegue ler (text-type,
 * computed-only, ou raw_metrics key que o connector não popula). Resultado:
 * config liga mas detector skipa silenciosamente — usuário acha que tá
 * monitorando, mas nada dispara.
 *
 * Estático: classifica cada metric_key do catálogo em direct/raw_jsonb/
 * text_incompatible/computed_only baseado em whitelist sincronizada com
 * o detector.
 *
 * Dinâmico: pra cada config enabled, conta nos últimos 14d quantas rows
 * de ad_metrics_daily tinham valor extraível. coverage_pct = sucessos /
 * total. coverage_pct=0 com rows>0 = órfã confirmada em runtime.
 */
@Injectable()
export class MetricCoverageService {
  private readonly logger = new Logger(MetricCoverageService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly configs: MetricConfigService,
  ) {}

  /**
   * Gera audit completo da org. Usado pelo endpoint REST + pelo warn
   * runtime do SignalDetector.
   */
  async auditCoverage(orgId: string): Promise<CoverageReport> {
    const configs = await this.configs.list(orgId, 'all');

    const rows = await this.fetchRecentRows(orgId, COVERAGE_WINDOW_DAYS);
    const noDataAtAll = rows.length === 0;

    const items: CoverageItem[] = configs.map((cfg) =>
      this.buildItem(cfg, rows),
    );

    const enabled = items.filter((i) => i.enabled);
    const orphan = enabled.filter((i) =>
      ORPHAN_STATUSES.has(i.status),
    );

    return {
      enabled_count: enabled.length,
      orphan_count: orphan.length,
      total_configs: items.length,
      window_days: COVERAGE_WINDOW_DAYS,
      no_data_at_all: noDataAtAll,
      items,
    };
  }

  /**
   * Loga warn pra cada config enabled com status órfão. Chamado pelo
   * SignalDetector ao fim de runForOrg. Throttle: só warna 1x por
   * (orgId, metric_key) por dia em memória — runtime daemon vai re-checar
   * sempre, mas log fica enxuto.
   */
  async warnOrphans(orgId: string): Promise<void> {
    let report: CoverageReport;
    try {
      report = await this.auditCoverage(orgId);
    } catch (err) {
      this.logger.warn(
        `auditCoverage falhou (skip warn): ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    if (report.no_data_at_all) {
      // Sem dados ainda — não tem como classificar como órfã. Provável
      // OAuth/sync ainda não rodou. Log silencioso pra evitar spam.
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    for (const item of report.items) {
      if (!item.enabled || !ORPHAN_STATUSES.has(item.status)) continue;
      const key = `${orgId}:${item.metric_key}:${today}`;
      if (this.warnedToday.has(key)) continue;
      this.warnedToday.add(key);
      this.logger.warn(
        `[coverage] org=${orgId} metric=${item.metric_key} status=${item.status} ` +
          `coverage=${item.coverage_pct}% rows=${item.rows_with_value}/${item.rows_checked} ` +
          `rec="${item.recommendation}"`,
      );
    }

    // GC quando o Set crescer demais (mais que 1 dia de dados extra)
    if (this.warnedToday.size > 5000) {
      this.warnedToday.clear();
    }
  }

  private warnedToday = new Set<string>();

  // ────────────────────────────────────────────
  // Privates
  // ────────────────────────────────────────────

  private buildItem(cfg: AdMetricConfig, rows: MetricRowLite[]): CoverageItem {
    const staticClass = classifyStatic(cfg.metric_key, cfg.catalog.data_type);

    if (!cfg.enabled) {
      return {
        metric_key: cfg.metric_key,
        display_name: cfg.catalog.display_name,
        platform: cfg.catalog.platform,
        category: cfg.catalog.category,
        enabled: false,
        static_class: staticClass,
        status: 'disabled',
        coverage_pct: 0,
        rows_checked: 0,
        rows_with_value: 0,
        last_seen_with_value: null,
        recommendation: 'Config desligada — sem efeito no detector.',
      };
    }

    // Estático bloqueia antes de ver dados
    if (staticClass === 'text_incompatible') {
      return {
        metric_key: cfg.metric_key,
        display_name: cfg.catalog.display_name,
        platform: cfg.catalog.platform,
        category: cfg.catalog.category,
        enabled: true,
        static_class: staticClass,
        status: 'text_incompatible',
        coverage_pct: 0,
        rows_checked: 0,
        rows_with_value: 0,
        last_seen_with_value: null,
        recommendation:
          'Métrica text-type (ex: ranking de qualidade). Pipeline numérico atual não compara. Desligue ou aguarde suporte futuro a comparações categóricas.',
      };
    }
    if (staticClass === 'computed_only') {
      return {
        metric_key: cfg.metric_key,
        display_name: cfg.catalog.display_name,
        platform: cfg.catalog.platform,
        category: cfg.catalog.category,
        enabled: true,
        static_class: staticClass,
        status: 'computed_only',
        coverage_pct: 0,
        rows_checked: 0,
        rows_with_value: 0,
        last_seen_with_value: null,
        recommendation:
          'Métrica derivada (precisa cálculo cliente). Connector atual não preenche — disponível em sprint futura. Considere monitorar a métrica base (clicks/impressions).',
      };
    }

    // Runtime: conta rows com valor extraível
    let rowsChecked = 0;
    let rowsWithValue = 0;
    let lastSeenWithValue: string | null = null;
    for (const r of rows) {
      rowsChecked += 1;
      const v = extractValue(r, cfg.metric_key);
      if (v !== null && Number.isFinite(v)) {
        rowsWithValue += 1;
        if (!lastSeenWithValue || r.date > lastSeenWithValue) {
          lastSeenWithValue = r.date;
        }
      }
    }

    if (rowsChecked === 0) {
      return {
        metric_key: cfg.metric_key,
        display_name: cfg.catalog.display_name,
        platform: cfg.catalog.platform,
        category: cfg.catalog.category,
        enabled: true,
        static_class: staticClass,
        status: 'no_data',
        coverage_pct: 0,
        rows_checked: 0,
        rows_with_value: 0,
        last_seen_with_value: null,
        recommendation:
          'Sem rows em ad_metrics_daily nos últimos ' +
          COVERAGE_WINDOW_DAYS +
          ' dias. Confirme que o sync Meta/Google está rodando (ads-sync-worker).',
      };
    }

    const coverage = Math.round((rowsWithValue / rowsChecked) * 10000) / 100;

    if (rowsWithValue === 0) {
      return {
        metric_key: cfg.metric_key,
        display_name: cfg.catalog.display_name,
        platform: cfg.catalog.platform,
        category: cfg.catalog.category,
        enabled: true,
        static_class: staticClass,
        status: 'orphan_no_value',
        coverage_pct: 0,
        rows_checked: rowsChecked,
        rows_with_value: 0,
        last_seen_with_value: null,
        recommendation:
          staticClass === 'raw_jsonb'
            ? `Chave "${cfg.metric_key}" nunca apareceu em raw_metrics. Provavelmente o connector da plataforma (${cfg.catalog.platform}) não solicita esse field. Reportar no backlog.`
            : `Sem valor extraível para "${cfg.metric_key}" mesmo com ${rowsChecked} rows na janela. Investigar connector.`,
      };
    }

    return {
      metric_key: cfg.metric_key,
      display_name: cfg.catalog.display_name,
      platform: cfg.catalog.platform,
      category: cfg.catalog.category,
      enabled: true,
      static_class: staticClass,
      status: 'healthy',
      coverage_pct: coverage,
      rows_checked: rowsChecked,
      rows_with_value: rowsWithValue,
      last_seen_with_value: lastSeenWithValue,
      recommendation:
        coverage < 50
          ? `Cobertura parcial (${coverage}%). Algumas campanhas não populam a métrica — pode ser normal (ex: vídeo só em campanhas de vídeo).`
          : 'OK — detector consegue extrair valor.',
    };
  }

  private async fetchRecentRows(
    orgId: string,
    days: number,
  ): Promise<MetricRowLite[]> {
    const cutoff = new Date(Date.now() - days * 86400_000)
      .toISOString()
      .slice(0, 10);
    const { data, error } = await this.supabase.adminClient
      .from('ad_metrics_daily')
      .select(
        'campaign_id, date, spend, impressions, clicks, ctr, cpc, cpm, conversions, cost_per_conversion, roas, raw_metrics',
      )
      .eq('org_id', orgId)
      .gte('date', cutoff)
      .order('date', { ascending: false })
      .limit(5000);
    if (error) {
      this.logger.error(`fetchRecentRows falhou: ${error.message}`);
      return [];
    }
    return (data ?? []) as MetricRowLite[];
  }
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface MetricRowLite {
  campaign_id: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversions: number;
  cost_per_conversion: number;
  roas: number;
  raw_metrics: Record<string, unknown>;
}

export type StaticClass =
  | 'direct'
  | 'raw_jsonb'
  | 'text_incompatible'
  | 'computed_only';

export type CoverageStatus =
  | 'healthy'
  | 'no_data'
  | 'orphan_no_value'
  | 'text_incompatible'
  | 'computed_only'
  | 'disabled';

export interface CoverageItem {
  metric_key: string;
  display_name: string;
  platform: string;
  category: string;
  enabled: boolean;
  static_class: StaticClass;
  status: CoverageStatus;
  /** % das rows na janela com valor extraível pra essa metric_key. */
  coverage_pct: number;
  rows_checked: number;
  rows_with_value: number;
  last_seen_with_value: string | null;
  recommendation: string;
}

export interface CoverageReport {
  enabled_count: number;
  orphan_count: number;
  total_configs: number;
  window_days: number;
  no_data_at_all: boolean;
  items: CoverageItem[];
}

// ─────────────────────────────────────────────────────────────
// Whitelists (sincronizadas com extractMetricValue do SignalDetector)
// ─────────────────────────────────────────────────────────────

/** Colunas explícitas em ad_metrics_daily. extractMetricValue tem fast-path. */
const DIRECT_COLUMNS = new Set([
  'spend',
  'impressions',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'conversions',
  'cost_per_conversion',
  'roas',
]);

/** Métricas text-type — pipeline numérico não compara (extract devolve null). */
const TEXT_INCOMPATIBLE = new Set([
  'quality_ranking',
  'engagement_rate_ranking',
  'conversion_rate_ranking',
]);

/**
 * Métricas derivadas que o connector não preenche pronto (precisaria cálculo
 * a partir de base). Atualmente o detector não calcula — sempre null.
 */
const COMPUTED_DERIVED = new Set([
  'conversion_rate', // conversions / clicks
  'link_ctr', // link_clicks / impressions
  'engagement_rate', // post_engagements / impressions
  'cost_per_purchase', // spend / purchases
]);

const COVERAGE_WINDOW_DAYS = 14;

const ORPHAN_STATUSES = new Set<CoverageStatus>([
  'orphan_no_value',
  'text_incompatible',
  'computed_only',
]);

function classifyStatic(key: string, dataType: string): StaticClass {
  if (DIRECT_COLUMNS.has(key)) return 'direct';
  if (TEXT_INCOMPATIBLE.has(key) || dataType === 'text') return 'text_incompatible';
  if (COMPUTED_DERIVED.has(key)) return 'computed_only';
  return 'raw_jsonb';
}

/**
 * Espelha extractMetricValue do SignalDetector. Mantido inline aqui pra
 * audit ser auto-suficiente; se a lógica de extração mudar lá, atualizar
 * aqui também (sinalizado nos comentários do detector).
 */
function extractValue(row: MetricRowLite, key: string): number | null {
  const direct: Record<string, number | undefined> = {
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.ctr,
    cpc: row.cpc,
    cpm: row.cpm,
    conversions: row.conversions,
    cost_per_conversion: row.cost_per_conversion,
    roas: row.roas,
  };
  if (direct[key] !== undefined) return direct[key] ?? null;

  const raw = row.raw_metrics as Record<string, unknown>;
  const v = raw?.[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
