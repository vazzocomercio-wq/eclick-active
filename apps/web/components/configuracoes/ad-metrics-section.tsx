'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  adMetricsApi,
  type AdMetricConfig,
  type ThresholdMode,
  type AggregationWindow,
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

  useEffect(() => {
    void reload();
  }, [platform]);

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
