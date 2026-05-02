'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import type {
  BusinessHoursConfig,
  BusinessHoursDayConfig,
  WeekdayKey,
} from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { businessHoursApi } from '@/lib/api/business-hours';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'São Paulo (GMT-3)' },
  { value: 'America/Manaus', label: 'Manaus (GMT-4)' },
  { value: 'America/Recife', label: 'Recife (GMT-3)' },
  { value: 'America/Belem', label: 'Belém (GMT-3)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (GMT-4)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (GMT-5)' },
  { value: 'America/Fortaleza', label: 'Fortaleza (GMT-3)' },
];

const WEEKDAYS: Array<{ key: WeekdayKey; label: string }> = [
  { key: 'mon', label: 'Segunda' },
  { key: 'tue', label: 'Terça' },
  { key: 'wed', label: 'Quarta' },
  { key: 'thu', label: 'Quinta' },
  { key: 'fri', label: 'Sexta' },
  { key: 'sat', label: 'Sábado' },
  { key: 'sun', label: 'Domingo' },
];

export function BusinessHoursTab() {
  const [config, setConfig] = useState<BusinessHoursConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await businessHoursApi.get();
        setConfig(cfg);
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro',
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function updateDay(key: WeekdayKey, patch: Partial<BusinessHoursDayConfig>) {
    if (!config) return;
    const current = config.schedule[key] ?? { enabled: false };
    setConfig({
      ...config,
      schedule: { ...config.schedule, [key]: { ...current, ...patch } },
    });
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      const saved = await businessHoursApi.update(config);
      setConfig(saved);
      toast.success('Horário comercial salvo');
    } catch (err) {
      toast.error('Falha ao salvar', {
        description:
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro',
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (!config) {
    return <p className="text-sm text-muted-foreground">Falha ao carregar configuração.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Master toggle */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Ativar horário comercial</span>
          <span className="text-xs text-muted-foreground">
            Quando ativo, fora do horário a IA pode responder automaticamente (configurável na persona).
          </span>
        </div>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
          className="h-5 w-5 rounded"
        />
      </div>

      {config.enabled && (
        <>
          <div className="rounded-xl border border-border bg-card p-4">
            <Label>Fuso horário</Label>
            <select
              value={config.timezone}
              onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
              className={cn(
                'mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring',
              )}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Grade semanal</h3>
            <div className="flex flex-col gap-2">
              {WEEKDAYS.map((d) => {
                const day = config.schedule[d.key] ?? { enabled: false };
                return (
                  <div
                    key={d.key}
                    className={cn(
                      'flex items-center gap-3 rounded-md border p-3 transition-colors',
                      day.enabled ? 'border-primary/30 bg-primary/5' : 'border-border bg-background',
                    )}
                  >
                    <label className="flex cursor-pointer items-center gap-2 min-w-[120px]">
                      <input
                        type="checkbox"
                        checked={day.enabled}
                        onChange={(e) => updateDay(d.key, { enabled: e.target.checked })}
                      />
                      <span className="text-sm font-medium">{d.label}</span>
                    </label>

                    {day.enabled ? (
                      <>
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="time"
                            value={day.start ?? '08:00'}
                            onChange={(e) => updateDay(d.key, { start: e.target.value })}
                            className="h-8 w-28 text-xs"
                          />
                          <span className="text-xs text-muted-foreground">até</span>
                          <Input
                            type="time"
                            value={day.end ?? '18:00'}
                            onChange={(e) => updateDay(d.key, { end: e.target.value })}
                            className="h-8 w-28 text-xs"
                          />
                        </div>
                        <DayBar start={day.start ?? '08:00'} end={day.end ?? '18:00'} />
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Fechado</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar horário
        </Button>
      </div>
    </div>
  );
}

function DayBar({ start, end }: { start: string; end: string }) {
  const startMin = parseHHMM(start);
  const endMin = parseHHMM(end);
  const dayMin = 24 * 60;
  const left = (startMin / dayMin) * 100;
  const width = Math.max(0, ((endMin - startMin) / dayMin) * 100);
  return (
    <div className="relative ml-auto h-2 flex-1 overflow-hidden rounded-full bg-muted">
      <div
        className="absolute top-0 bottom-0 bg-primary/60"
        style={{ left: `${left}%`, width: `${width}%` }}
      />
    </div>
  );
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
