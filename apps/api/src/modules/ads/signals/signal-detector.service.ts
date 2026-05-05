import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  AdMetricConfig,
  MetricConfigService,
} from '../metric-config.service';

export type SignalType =
  | 'metric_threshold'
  | 'metric_anomaly'
  | 'creative_fatigue'
  | 'audience_burnout'
  | 'scaling_inefficiency'
  | 'pixel_drift';
// Nota: 'lead_unattended' fica fora do MVP (depende do Bloco F — Lead Ads webhook)

export type SignalSeverity = 'warning' | 'critical';

interface SignalDraft {
  org_id: string;
  integration_id: string | null;
  campaign_id: string | null;
  platform: 'meta' | 'google';
  signal_type: SignalType;
  metric_key: string | null;
  severity: SignalSeverity;
  current_value: number | null;
  threshold_value: number | null;
  payload: Record<string, unknown>;
  dedupe_key: string;
}

export interface DetectorRunResult {
  org_id: string;
  layer1: number;
  layer2: number;
  layer3: number;
  total: number;
  duration_ms: number;
}

interface CampaignWithMetrics {
  id: string;
  integration_id: string;
  platform: 'meta' | 'google';
  name: string;
  status: string;
}

interface MetricRow {
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

const LAYER3_LOOKBACK_DAYS = 14;

/**
 * SignalDetector — núcleo do Bloco G.
 *
 * Filosofia: 3 camadas independentes, todas baratas (SQL puro + lógica
 * em memória pra agregações). Sem LLM aqui — narrativa é Camada 4
 * (Bloco H).
 *
 * Camada 1 — Regras determinísticas
 *   Pra cada config enabled+threshold_mode='manual' COM target_value,
 *   compara o valor agregado da janela contra target ± warning_pct/critical_pct.
 *   Respeita `direction` (higher_better → valor < target dispara).
 *
 * Camada 2 — Anomaly detection
 *   Pra cada config enabled+threshold_mode='auto', calcula média rolling
 *   + desvio padrão da janela de baseline. Se valor atual desvia > 2σ →
 *   warning; > 3σ → critical.
 *
 * Camada 3 — Sinais compostos (templates hardcoded)
 *   Cruzam métricas. User liga via flag em settings (default off).
 *   - creative_fatigue: CTR cai + frequency sobe + CPC sobe (7d vs 7d)
 *   - audience_burnout: frequency > 4 + CTR cai > 30% (7d)
 *   - scaling_inefficiency: spend dobra mas conversões crescem < 50%
 *   - pixel_drift: conversões caem > 50% mantendo spend
 */
@Injectable()
export class SignalDetectorService {
  private readonly logger = new Logger(SignalDetectorService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly metricConfig: MetricConfigService,
  ) {}

  // ────────────────────────────────────────────
  // Entry point — roda as 3 camadas pra uma org
  // ────────────────────────────────────────────

  async runForOrg(orgId: string): Promise<DetectorRunResult> {
    const start = Date.now();

    const campaigns = await this.fetchActiveCampaigns(orgId);
    if (campaigns.length === 0) {
      return {
        org_id: orgId,
        layer1: 0,
        layer2: 0,
        layer3: 0,
        total: 0,
        duration_ms: Date.now() - start,
      };
    }

    const configs = await this.metricConfig.list(orgId, 'all');

    // Carrega métricas dos últimos N dias pra todas as campaigns de uma vez.
    // É barato — `(org_id, date DESC)` está indexado.
    const metricsByCampaign = await this.fetchRecentMetrics(orgId, LAYER3_LOOKBACK_DAYS);

    const drafts: SignalDraft[] = [];

    // Camada 1
    const layer1Drafts = this.detectLayer1Manual({
      orgId,
      campaigns,
      configs,
      metricsByCampaign,
    });
    drafts.push(...layer1Drafts);

    // Camada 2
    const layer2Drafts = this.detectLayer2Anomaly({
      orgId,
      campaigns,
      configs,
      metricsByCampaign,
    });
    drafts.push(...layer2Drafts);

    // Camada 3 — composed templates
    const layer3Drafts = this.detectLayer3Composed({
      orgId,
      campaigns,
      metricsByCampaign,
    });
    drafts.push(...layer3Drafts);

    // Persiste com dedupe (UNIQUE WHERE status='pending')
    const persistedCount = await this.persistDrafts(drafts);

    return {
      org_id: orgId,
      layer1: layer1Drafts.length,
      layer2: layer2Drafts.length,
      layer3: layer3Drafts.length,
      total: persistedCount,
      duration_ms: Date.now() - start,
    };
  }

  /** Lista IDs de orgs com pelo menos 1 integração ativa (worker usa). */
  async listOrgsWithActiveIntegrations(): Promise<string[]> {
    const { data, error } = await this.supabase.adminClient
      .from('ad_integrations')
      .select('org_id')
      .eq('status', 'active');
    if (error) {
      this.logger.error(`listOrgsWithActiveIntegrations falhou: ${error.message}`);
      return [];
    }
    const ids = ((data ?? []) as Array<{ org_id: string }>).map((r) => r.org_id);
    return Array.from(new Set(ids));
  }

  // ────────────────────────────────────────────
  // Camada 1 — Regras determinísticas
  // ────────────────────────────────────────────

  private detectLayer1Manual(args: {
    orgId: string;
    campaigns: CampaignWithMetrics[];
    configs: AdMetricConfig[];
    metricsByCampaign: Map<string, MetricRow[]>;
  }): SignalDraft[] {
    const drafts: SignalDraft[] = [];

    const manualConfigs = args.configs.filter(
      (c) => c.enabled && c.threshold_mode === 'manual' && c.target_value !== null,
    );
    if (manualConfigs.length === 0) return drafts;

    for (const camp of args.campaigns) {
      const metrics = args.metricsByCampaign.get(camp.id) ?? [];
      if (metrics.length === 0) continue;

      for (const cfg of manualConfigs) {
        const value = aggregateMetric(metrics, cfg.metric_key, cfg.aggregation_window, cfg.catalog.aggregation);
        if (value === null) continue;

        const target = cfg.target_value as number;
        const direction = cfg.catalog.direction;
        const violation = computeViolation(value, target, direction);
        if (violation === null) continue; // ainda dentro do alvo

        let severity: SignalSeverity | null = null;
        if (violation >= cfg.critical_pct) severity = 'critical';
        else if (violation >= cfg.warning_pct) severity = 'warning';
        if (severity === null) continue;

        drafts.push({
          org_id: args.orgId,
          integration_id: camp.integration_id,
          campaign_id: camp.id,
          platform: camp.platform,
          signal_type: 'metric_threshold',
          metric_key: cfg.metric_key,
          severity,
          current_value: roundForStorage(value),
          threshold_value: roundForStorage(target),
          payload: {
            campaign_name: camp.name,
            metric_display: cfg.catalog.display_name,
            unit: cfg.catalog.unit,
            direction,
            violation_pct: roundForStorage(violation),
            warning_pct: cfg.warning_pct,
            critical_pct: cfg.critical_pct,
            aggregation_window: cfg.aggregation_window,
          },
          dedupe_key: bucketKey('metric_threshold', `${camp.id}:${cfg.metric_key}`),
        });
      }
    }

    return drafts;
  }

  // ────────────────────────────────────────────
  // Camada 2 — Anomaly detection
  // ────────────────────────────────────────────

  private detectLayer2Anomaly(args: {
    orgId: string;
    campaigns: CampaignWithMetrics[];
    configs: AdMetricConfig[];
    metricsByCampaign: Map<string, MetricRow[]>;
  }): SignalDraft[] {
    const drafts: SignalDraft[] = [];

    const autoConfigs = args.configs.filter(
      (c) => c.enabled && c.threshold_mode === 'auto',
    );
    if (autoConfigs.length === 0) return drafts;

    for (const camp of args.campaigns) {
      const metrics = args.metricsByCampaign.get(camp.id) ?? [];
      if (metrics.length < 7) continue; // baseline mínimo

      // Métricas vêm DESC por date — pega o mais recente
      const latest = metrics[0];
      if (!latest) continue;

      for (const cfg of autoConfigs) {
        const baselineWindow = Math.min(cfg.baseline_window_days, metrics.length - 1);
        const baselineRows = metrics.slice(1, baselineWindow + 1);
        if (baselineRows.length < 5) continue; // baseline insuficiente

        const baselineValues = baselineRows
          .map((r) => extractMetricValue(r, cfg.metric_key))
          .filter((v): v is number => v !== null && Number.isFinite(v));
        if (baselineValues.length < 5) continue;

        const mean = average(baselineValues);
        const stddev = standardDeviation(baselineValues, mean);
        if (stddev === 0) continue; // métrica constante — sem anomalia possível

        const current = extractMetricValue(latest, cfg.metric_key);
        if (current === null) continue;

        const sigmas = Math.abs((current - mean) / stddev);
        let severity: SignalSeverity | null = null;
        if (sigmas >= 3) severity = 'critical';
        else if (sigmas >= 2) severity = 'warning';
        if (severity === null) continue;

        // Só dispara se a direção da anomalia for "ruim" segundo o catálogo
        const isWorse = isAnomalyBad(current, mean, cfg.catalog.direction);
        if (!isWorse) continue;

        drafts.push({
          org_id: args.orgId,
          integration_id: camp.integration_id,
          campaign_id: camp.id,
          platform: camp.platform,
          signal_type: 'metric_anomaly',
          metric_key: cfg.metric_key,
          severity,
          current_value: roundForStorage(current),
          threshold_value: roundForStorage(mean),
          payload: {
            campaign_name: camp.name,
            metric_display: cfg.catalog.display_name,
            unit: cfg.catalog.unit,
            direction: cfg.catalog.direction,
            sigmas: roundForStorage(sigmas),
            baseline_mean: roundForStorage(mean),
            baseline_stddev: roundForStorage(stddev),
            baseline_window_days: cfg.baseline_window_days,
            sample_size: baselineValues.length,
          },
          dedupe_key: bucketKey('metric_anomaly', `${camp.id}:${cfg.metric_key}`),
        });
      }
    }

    return drafts;
  }

  // ────────────────────────────────────────────
  // Camada 3 — Sinais compostos
  // ────────────────────────────────────────────

  private detectLayer3Composed(args: {
    orgId: string;
    campaigns: CampaignWithMetrics[];
    metricsByCampaign: Map<string, MetricRow[]>;
  }): SignalDraft[] {
    const drafts: SignalDraft[] = [];

    for (const camp of args.campaigns) {
      const metrics = args.metricsByCampaign.get(camp.id) ?? [];
      if (metrics.length < 14) continue; // precisamos 7d recente vs 7d anterior

      // Janelas: últimos 7d (recent) vs 7d anteriores (prior)
      const recent = metrics.slice(0, 7);
      const prior = metrics.slice(7, 14);
      if (recent.length < 7 || prior.length < 7) continue;

      const recentAgg = aggregate7d(recent);
      const priorAgg = aggregate7d(prior);

      // ── creative_fatigue: CTR↓ >20% + frequency↑ >30% + CPC↑ >20%
      const ctrDelta = pctDelta(recentAgg.ctr, priorAgg.ctr);
      const freqDelta = pctDelta(recentAgg.frequency, priorAgg.frequency);
      const cpcDelta = pctDelta(recentAgg.cpc, priorAgg.cpc);
      if (
        priorAgg.ctr > 0 &&
        priorAgg.frequency > 0 &&
        ctrDelta <= -20 &&
        freqDelta >= 30 &&
        cpcDelta >= 20
      ) {
        drafts.push({
          org_id: args.orgId,
          integration_id: camp.integration_id,
          campaign_id: camp.id,
          platform: camp.platform,
          signal_type: 'creative_fatigue',
          metric_key: null,
          severity: 'warning',
          current_value: null,
          threshold_value: null,
          payload: {
            campaign_name: camp.name,
            ctr_change_pct: roundForStorage(ctrDelta),
            frequency_change_pct: roundForStorage(freqDelta),
            cpc_change_pct: roundForStorage(cpcDelta),
            recent: recentAgg,
            prior: priorAgg,
          },
          dedupe_key: bucketKey('creative_fatigue', camp.id),
        });
      }

      // ── audience_burnout: freq atual > 4 + CTR cai > 30%
      if (recentAgg.frequency > 4 && priorAgg.ctr > 0 && ctrDelta <= -30) {
        drafts.push({
          org_id: args.orgId,
          integration_id: camp.integration_id,
          campaign_id: camp.id,
          platform: camp.platform,
          signal_type: 'audience_burnout',
          metric_key: null,
          severity: 'warning',
          current_value: roundForStorage(recentAgg.frequency),
          threshold_value: 4,
          payload: {
            campaign_name: camp.name,
            frequency: recentAgg.frequency,
            ctr_drop_pct: roundForStorage(Math.abs(ctrDelta)),
          },
          dedupe_key: bucketKey('audience_burnout', camp.id),
        });
      }

      // ── scaling_inefficiency: spend dobra (>=100%) mas conversões crescem < 50%
      const spendDelta = pctDelta(recentAgg.spend, priorAgg.spend);
      const convDelta = pctDelta(recentAgg.conversions, priorAgg.conversions);
      if (priorAgg.spend > 0 && spendDelta >= 100 && convDelta < 50) {
        drafts.push({
          org_id: args.orgId,
          integration_id: camp.integration_id,
          campaign_id: camp.id,
          platform: camp.platform,
          signal_type: 'scaling_inefficiency',
          metric_key: null,
          severity: spendDelta >= 200 ? 'critical' : 'warning',
          current_value: null,
          threshold_value: null,
          payload: {
            campaign_name: camp.name,
            spend_change_pct: roundForStorage(spendDelta),
            conversions_change_pct: roundForStorage(convDelta),
            recent: { spend: recentAgg.spend, conversions: recentAgg.conversions },
            prior: { spend: priorAgg.spend, conversions: priorAgg.conversions },
          },
          dedupe_key: bucketKey('scaling_inefficiency', camp.id),
        });
      }

      // ── pixel_drift: conversões caem > 50% sem mudar spend significativamente
      if (
        priorAgg.conversions > 5 &&
        Math.abs(spendDelta) < 20 && // spend praticamente igual
        convDelta <= -50
      ) {
        drafts.push({
          org_id: args.orgId,
          integration_id: camp.integration_id,
          campaign_id: camp.id,
          platform: camp.platform,
          signal_type: 'pixel_drift',
          metric_key: null,
          severity: 'critical',
          current_value: roundForStorage(recentAgg.conversions),
          threshold_value: roundForStorage(priorAgg.conversions),
          payload: {
            campaign_name: camp.name,
            conversions_drop_pct: roundForStorage(Math.abs(convDelta)),
            spend_change_pct: roundForStorage(spendDelta),
            recent: { conversions: recentAgg.conversions, spend: recentAgg.spend },
            prior: { conversions: priorAgg.conversions, spend: priorAgg.spend },
          },
          dedupe_key: bucketKey('pixel_drift', camp.id),
        });
      }
    }

    return drafts;
  }

  // ────────────────────────────────────────────
  // Persistência (com dedupe via UNIQUE pending)
  // ────────────────────────────────────────────

  private async persistDrafts(drafts: SignalDraft[]): Promise<number> {
    if (drafts.length === 0) return 0;

    let persisted = 0;
    // Insere um por um — UNIQUE INDEX WHERE status='pending' faz dedupe.
    // ON CONFLICT DO NOTHING não funciona em UNIQUE parcial, então usamos
    // try/catch + checagem prévia.
    for (const d of drafts) {
      const { data: existing } = await this.supabase.adminClient
        .from('ad_signals')
        .select('id')
        .eq('org_id', d.org_id)
        .eq('dedupe_key', d.dedupe_key)
        .eq('status', 'pending')
        .maybeSingle();

      if (existing) continue; // já tem pendente igual

      const { error } = await this.supabase.adminClient.from('ad_signals').insert({
        org_id: d.org_id,
        integration_id: d.integration_id,
        campaign_id: d.campaign_id,
        platform: d.platform,
        signal_type: d.signal_type,
        metric_key: d.metric_key,
        severity: d.severity,
        current_value: d.current_value,
        threshold_value: d.threshold_value,
        payload: d.payload,
        dedupe_key: d.dedupe_key,
      });
      if (error) {
        // Race condition no UNIQUE — outro tick inseriu primeiro. Ignora.
        if (!error.message.includes('duplicate key')) {
          this.logger.warn(`insert ad_signal falhou: ${error.message}`);
        }
        continue;
      }
      persisted += 1;
    }
    return persisted;
  }

  // ────────────────────────────────────────────
  // Data fetchers
  // ────────────────────────────────────────────

  private async fetchActiveCampaigns(orgId: string): Promise<CampaignWithMetrics[]> {
    const { data, error } = await this.supabase.adminClient
      .from('ad_campaigns')
      .select('id, integration_id, platform, name, status')
      .eq('org_id', orgId)
      .in('status', ['ACTIVE', 'enabled', 'active']); // status varia por plataforma

    if (error) {
      this.logger.error(`fetchActiveCampaigns falhou: ${error.message}`);
      return [];
    }
    return (data ?? []) as CampaignWithMetrics[];
  }

  private async fetchRecentMetrics(
    orgId: string,
    days: number,
  ): Promise<Map<string, MetricRow[]>> {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const { data, error } = await this.supabase.adminClient
      .from('ad_metrics_daily')
      .select(
        'campaign_id, date, spend, impressions, clicks, ctr, cpc, cpm, conversions, cost_per_conversion, roas, raw_metrics',
      )
      .eq('org_id', orgId)
      .gte('date', cutoff)
      .order('date', { ascending: false });

    if (error) {
      this.logger.error(`fetchRecentMetrics falhou: ${error.message}`);
      return new Map();
    }

    const map = new Map<string, MetricRow[]>();
    for (const r of (data ?? []) as MetricRow[]) {
      const list = map.get(r.campaign_id) ?? [];
      list.push(r);
      map.set(r.campaign_id, list);
    }
    return map;
  }
}

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

function bucketKey(signalType: string, idOrPath: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${signalType}:${idOrPath}:${today}`;
}

function aggregateMetric(
  metrics: MetricRow[],
  metricKey: string,
  window: 'day' | '7d' | '30d',
  aggregation: string,
): number | null {
  const days = window === 'day' ? 1 : window === '7d' ? 7 : 30;
  const slice = metrics.slice(0, days);
  const values = slice
    .map((r) => extractMetricValue(r, metricKey))
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;

  switch (aggregation) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return average(values);
    case 'last':
      return values[0] ?? null;
    default:
      return average(values);
  }
}

/**
 * Mapeia metric_key → coluna em ad_metrics_daily ou campo em raw_metrics.
 * Pra MVP usamos as colunas explícitas; métricas que só vêm em `raw_metrics`
 * (frequency, reach, video_*, quality_ranking) extraímos do jsonb.
 */
function extractMetricValue(row: MetricRow, key: string): number | null {
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

  // raw_metrics — Meta retorna como string
  const raw = row.raw_metrics as Record<string, unknown>;
  const v = raw?.[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function computeViolation(value: number, target: number, direction: string): number | null {
  if (target === 0) return null;
  const delta = value - target;
  // higher_better → valor menor que target = violação positiva
  // lower_better  → valor maior que target = violação positiva
  // neutral       → variação em qualquer direção conta
  let pct: number;
  if (direction === 'higher_better') {
    if (value >= target) return null; // bom
    pct = ((target - value) / Math.abs(target)) * 100;
  } else if (direction === 'lower_better') {
    if (value <= target) return null; // bom
    pct = ((value - target) / Math.abs(target)) * 100;
  } else {
    pct = (Math.abs(delta) / Math.abs(target)) * 100;
  }
  return pct;
}

function isAnomalyBad(current: number, baseline: number, direction: string): boolean {
  if (direction === 'higher_better') return current < baseline; // caiu = ruim
  if (direction === 'lower_better') return current > baseline; // subiu = ruim
  return true; // neutral — qualquer anomalia é interessante
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function standardDeviation(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const sumSq = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  return Math.sqrt(sumSq / (values.length - 1));
}

function pctDelta(current: number, prior: number): number {
  if (prior === 0) return current === 0 ? 0 : 100;
  return ((current - prior) / Math.abs(prior)) * 100;
}

interface Window7dAgg {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversions: number;
  frequency: number;
  reach: number;
}

function aggregate7d(rows: MetricRow[]): Window7dAgg {
  const spend = sum(rows.map((r) => r.spend));
  const impressions = sum(rows.map((r) => r.impressions));
  const clicks = sum(rows.map((r) => r.clicks));
  const conversions = sum(rows.map((r) => r.conversions));
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const cpm = impressions > 0 ? (spend * 1000) / impressions : 0;
  const reach = sum(
    rows.map((r) => {
      const v = (r.raw_metrics as Record<string, unknown>)?.reach;
      return typeof v === 'string' ? Number(v) || 0 : typeof v === 'number' ? v : 0;
    }),
  );
  // frequency = impressions / reach (média aritmética)
  const frequency = reach > 0 ? impressions / reach : 0;
  return {
    spend: roundForStorage(spend),
    impressions: roundForStorage(impressions),
    clicks: roundForStorage(clicks),
    ctr: roundForStorage(ctr),
    cpc: roundForStorage(cpc),
    cpm: roundForStorage(cpm),
    conversions: roundForStorage(conversions),
    frequency: roundForStorage(frequency),
    reach: roundForStorage(reach),
  };
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function roundForStorage(n: number): number {
  return Math.round(n * 10000) / 10000;
}
