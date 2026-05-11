'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  adMetricsApi,
  adSignalsApi,
  type AdMetricConfig,
  type AggregationWindow,
  type CoverageItem,
  type CoverageReport,
  type CoverageStatus,
  type ThresholdMode,
} from '@/lib/api/active-intelligence';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const PLATFORM_TABS: Array<{ key: 'all' | 'meta' | 'google' | 'shared'; label: string }> = [
  { key: 'all', label: 'Todas' },
  { key: 'shared', label: 'Compartilhadas' },
  { key: 'meta', label: 'Meta' },
  { key: 'google', label: 'Google' },
];

/**
 * /configuracoes > Métricas Monitoradas.
 *
 * Lista catálogo de métricas com configs por org. User toggle enabled,
 * threshold_mode, target_value, warning/critical pcts. Agrupa por
 * categoria pra UX limpa.
 */
export function AdMetricsSection() {
  const [configs, setConfigs] = useState<AdMetricConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState<'all' | 'meta' | 'google' | 'shared'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [coverageOpen, setCoverageOpen] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const data = await adMetricsApi.listConfigs(platform);
      setConfigs(data);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao carregar métricas');
    } finally {
      setLoading(false);
    }
  }

  async function reloadCoverage() {
    try {
      const report = await adSignalsApi.metricCoverage();
      setCoverage(report);
    } catch (err) {
      // Audit é nice-to-have — se falhar, oculta banner ao invés de quebrar a página
      if (err instanceof ApiError) {
        console.warn(`[ad-metrics] coverage falhou: ${err.message}`);
      }
    }
  }

  useEffect(() => {
    void reload();
  }, [platform]);

  // Coverage audit roda 1x quando a tela monta (não depende de platform filter
  // — sempre mostra contagem global)
  useEffect(() => {
    void reloadCoverage();
  }, []);

  async function patchConfig(metricKey: string, patch: Parameters<typeof adMetricsApi.updateConfig>[1]) {
    setSavingKey(metricKey);
    try {
      const next = await adMetricsApi.updateConfig(metricKey, patch);
      setConfigs((prev) => prev.map((c) => (c.metric_key === metricKey ? next : c)));
      toast.success('Salvo');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao salvar');
    } finally {
      setSavingKey(null);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, AdMetricConfig[]>();
    for (const c of configs) {
      const cat = c.catalog.category;
      const list = map.get(cat) ?? [];
      list.push(c);
      map.set(cat, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [configs]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Métricas Monitoradas
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Escolha quais métricas monitorar e defina thresholds. Sinais são gerados quando bate o limite.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Coverage audit banner */}
        {coverage && (
          <CoverageBanner
            report={coverage}
            open={coverageOpen}
            onToggle={() => setCoverageOpen((v) => !v)}
          />
        )}

        {/* Platform filter tabs */}
        <div className="flex shrink-0 gap-1 overflow-x-auto">
          {PLATFORM_TABS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPlatform(p.key)}
              className={cn(
                'shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors',
                platform === p.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {grouped.map(([category, items]) => (
              <div key={category} className="flex flex-col gap-1.5">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {category}
                </div>
                <div className="flex flex-col gap-1">
                  {items.map((c) => (
                    <MetricRow
                      key={c.metric_key}
                      config={c}
                      expanded={expanded === c.metric_key}
                      saving={savingKey === c.metric_key}
                      onToggleExpand={() =>
                        setExpanded(expanded === c.metric_key ? null : c.metric_key)
                      }
                      onPatch={(patch) => patchConfig(c.metric_key, patch)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricRow({
  config,
  expanded,
  saving,
  onToggleExpand,
  onPatch,
}: {
  config: AdMetricConfig;
  expanded: boolean;
  saving: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Parameters<typeof adMetricsApi.updateConfig>[1]) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-card/30">
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/30"
      >
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => {
              e.stopPropagation();
              onPatch({ enabled: e.target.checked });
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 shrink-0 cursor-pointer"
          />
          <span className="truncate text-sm">{config.catalog.display_name}</span>
          {config.catalog.is_core && (
            <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium uppercase text-primary">
              Core
            </span>
          )}
          <span className="text-[10px] uppercase text-muted-foreground">
            {config.catalog.platform}
          </span>
          {config.virtual && (
            <span className="text-[10px] text-muted-foreground italic">(default)</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          {config.threshold_mode === 'manual' && config.target_value !== null
            ? `alvo ${config.target_value} ${config.catalog.unit}`
            : config.threshold_mode === 'auto'
              ? 'baseline auto'
              : 'sem alvo'}
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="grid grid-cols-1 gap-3 border-t border-border bg-card/50 px-3 py-3 sm:grid-cols-2">
          <div className="col-span-1 text-xs text-muted-foreground sm:col-span-2">
            {config.catalog.description}
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase">Modo de threshold</Label>
            <select
              value={config.threshold_mode}
              onChange={(e) =>
                onPatch({ threshold_mode: e.target.value as ThresholdMode })
              }
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="manual">Manual (define alvo)</option>
              <option value="auto">Auto (baseline rolling)</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase">Janela</Label>
            <select
              value={config.aggregation_window}
              onChange={(e) =>
                onPatch({ aggregation_window: e.target.value as AggregationWindow })
              }
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="day">Dia atual</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
            </select>
          </div>

          {config.threshold_mode === 'manual' && (
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase">
                Alvo ({config.catalog.unit})
              </Label>
              <Input
                type="number"
                step="0.01"
                value={config.target_value ?? ''}
                onChange={(e) =>
                  onPatch({
                    target_value: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                placeholder="ex: 3.0"
              />
            </div>
          )}

          {config.threshold_mode === 'auto' && (
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase">Baseline (dias)</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={config.baseline_window_days}
                onChange={(e) =>
                  onPatch({ baseline_window_days: Number(e.target.value) })
                }
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase">Warning %</Label>
            <Input
              type="number"
              min={0}
              max={200}
              value={config.warning_pct}
              onChange={(e) => onPatch({ warning_pct: Number(e.target.value) })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase">Critical %</Label>
            <Input
              type="number"
              min={0}
              max={200}
              value={config.critical_pct}
              onChange={(e) => onPatch({ critical_pct: Number(e.target.value) })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Coverage audit banner — exposição de configs órfãs
// ─────────────────────────────────────────────────────────────

function CoverageBanner({
  report,
  open,
  onToggle,
}: {
  report: CoverageReport;
  open: boolean;
  onToggle: () => void;
}) {
  const { enabled_count, orphan_count, no_data_at_all } = report;
  const tone =
    orphan_count > 0
      ? 'warning'
      : no_data_at_all
        ? 'info'
        : 'ok';

  const headline =
    orphan_count > 0
      ? `${orphan_count} ${orphan_count === 1 ? 'config órfã' : 'configs órfãs'} de ${enabled_count} ativas`
      : no_data_at_all
        ? 'Sem dados de ads sincronizados ainda'
        : `Tudo certo — ${enabled_count} configs ativas com cobertura saudável`;

  const subline =
    orphan_count > 0
      ? 'Configs ligadas que silenciosamente não disparam por mismatch entre catálogo e dados sincronizados.'
      : no_data_at_all
        ? 'Conecte Meta/Google Ads em "Integrações" pra começar a sincronizar métricas.'
        : `Analisado contra ${report.window_days} dias de ad_metrics_daily.`;

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border px-3 py-2.5',
        tone === 'warning' && 'border-amber-500/40 bg-amber-500/5',
        tone === 'info' && 'border-blue-500/40 bg-blue-500/5',
        tone === 'ok' && 'border-emerald-500/40 bg-emerald-500/5',
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            'mt-0.5 shrink-0',
            tone === 'warning' && 'text-amber-500',
            tone === 'info' && 'text-blue-500',
            tone === 'ok' && 'text-emerald-500',
          )}
        >
          {tone === 'warning' ? (
            <AlertTriangle className="h-4 w-4" />
          ) : tone === 'info' ? (
            <Info className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs font-semibold">{headline}</span>
          <span className="text-[11px] text-muted-foreground">{subline}</span>
        </div>
        {orphan_count > 0 && (
          <button
            type="button"
            onClick={onToggle}
            className="shrink-0 text-[11px] font-medium text-primary hover:underline"
          >
            {open ? 'Esconder' : 'Ver detalhes'}
          </button>
        )}
      </div>

      {open && orphan_count > 0 && (
        <div className="mt-1 flex flex-col gap-1.5 border-t border-border/50 pt-2">
          {report.items
            .filter((i) => i.enabled && ORPHAN_STATUSES.has(i.status))
            .map((item) => (
              <OrphanRow key={item.metric_key} item={item} />
            ))}
        </div>
      )}
    </div>
  );
}

const ORPHAN_STATUSES = new Set<CoverageStatus>([
  'orphan_no_value',
  'text_incompatible',
  'computed_only',
]);

function OrphanRow({ item }: { item: CoverageItem }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border/50 bg-background/40 px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium">{item.display_name}</span>
          <code className="shrink-0 rounded-sm bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
            {item.metric_key}
          </code>
          <CoverageStatusBadge status={item.status} />
        </div>
        {item.rows_checked > 0 && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {item.rows_with_value}/{item.rows_checked} rows
          </span>
        )}
      </div>
      <span className="text-[10px] text-muted-foreground">{item.recommendation}</span>
    </div>
  );
}

function CoverageStatusBadge({ status }: { status: CoverageStatus }) {
  const cfg: Record<CoverageStatus, { label: string; cls: string }> = {
    healthy: { label: 'OK', cls: 'bg-emerald-500/15 text-emerald-600' },
    no_data: { label: 'sem dados', cls: 'bg-blue-500/15 text-blue-500' },
    orphan_no_value: { label: 'órfã', cls: 'bg-amber-500/15 text-amber-600' },
    text_incompatible: { label: 'tipo text', cls: 'bg-amber-500/15 text-amber-600' },
    computed_only: { label: 'derivada', cls: 'bg-amber-500/15 text-amber-600' },
    disabled: { label: 'off', cls: 'bg-muted text-muted-foreground' },
  };
  const c = cfg[status];
  return (
    <span className={cn('shrink-0 rounded-sm px-1.5 py-0.5 text-[9px] font-medium', c.cls)}>
      {c.label}
    </span>
  );
}
