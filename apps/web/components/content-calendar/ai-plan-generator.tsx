'use client';

import { useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  contentCalendarApi,
  CHANNEL_COLOR,
  CHANNEL_LABEL,
  type ContentCalendarEvent,
  type ContentChannel,
  type GeneratePlanInput,
} from '@/lib/api/content-calendar';
import { cn } from '@/lib/utils';

interface AIPlanGeneratorProps {
  open: boolean;
  onClose: () => void;
  onGenerated: (events: ContentCalendarEvent[]) => void;
}

const CHANNELS: ContentChannel[] = [
  'instagram',
  'facebook',
  'tiktok',
  'whatsapp',
  'email',
  'meta_ads',
  'google_ads',
];

/**
 * Modal que coleta período + canais + contexto e dispara
 * `/content-calendar/generate-plan`. Mostra preview dos eventos gerados
 * antes de confirmar inserção (já vêm inseridos pelo backend; aqui só
 * confirmamos ou descartamos).
 */
export function AIPlanGenerator({
  open,
  onClose,
  onGenerated,
}: AIPlanGeneratorProps) {
  const t = useTranslations('contentCalendar');
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [startDate, setStartDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [channels, setChannels] = useState<ContentChannel[]>([
    'instagram',
    'whatsapp',
  ]);
  const [businessContext, setBusinessContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState<number | null>(null);

  function toggleChannel(c: ContentChannel) {
    setChannels((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }

  async function handleGenerate() {
    if (channels.length === 0) {
      setError(t('ai.selectAtLeastOne'));
      return;
    }
    setBusy(true);
    setError(null);
    setCostUsd(null);

    try {
      const body: GeneratePlanInput = {
        period,
        start_date: startDate,
        channels,
        ...(businessContext.trim()
          ? { business_context: businessContext.trim() }
          : {}),
      };
      const result = await contentCalendarApi.generatePlan(body);
      setCostUsd(result.cost_usd);
      onGenerated(result.events);
      // Fecha automaticamente após 1.5s pra usuário ver custo
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ai.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
      />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-cyan-500 to-blue-600">
              <Sparkles className="h-4 w-4 text-white" />
            </span>
            <h2 className="text-sm font-semibold">{t('ai.title')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-3 p-4">
          {/* Período */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('ai.periodLabel')}
            </label>
            <div className="flex gap-1">
              {(['week', 'month'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={cn(
                    'flex-1 rounded-md border px-3 py-2 text-xs font-medium',
                    period === p
                      ? 'border-cyan-400/60 bg-cyan-500/10 text-cyan-300'
                      : 'border-border hover:bg-accent',
                  )}
                >
                  {t(`ai.period.${p}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Data inicial */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('ai.startLabel')}
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Canais */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('ai.channelsLabel', { n: channels.length })}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CHANNELS.map((c) => {
                const selected = channels.includes(c);
                const color = CHANNEL_COLOR[c];
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleChannel(c)}
                    className={cn(
                      'inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all',
                      selected ? 'opacity-100' : 'opacity-40 hover:opacity-70',
                    )}
                    style={{
                      borderColor: `${color}66`,
                      backgroundColor: `${color}1a`,
                      color,
                    }}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    {CHANNEL_LABEL[c]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contexto do negócio */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('ai.businessContextLabel')}
            </label>
            <textarea
              value={businessContext}
              onChange={(e) => setBusinessContext(e.target.value)}
              rows={3}
              placeholder={t('ai.businessContextPlaceholder')}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm"
              maxLength={500}
            />
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          {costUsd !== null && (
            <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-300">
              {t('ai.doneToast', { cost: costUsd.toFixed(4) })}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-border px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            {t('ai.cancel')}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy || channels.length === 0}
            className="flex items-center gap-1.5 rounded-md bg-cyan-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-cyan-400 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('ai.generating')}
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                {t('ai.generate')}
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
