'use client';

import { Calendar } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type PresetKey = '7d' | '30d' | '90d' | 'today';

export interface Period {
  from: string;
  to: string;
  preset?: PresetKey;
}

interface PeriodSelectorProps {
  value: Period;
  onChange: (next: Period) => void;
}

const PRESETS: Array<{ key: PresetKey; days: number }> = [
  { key: 'today', days: 0 },
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
];

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  const t = useTranslations('relatorios');
  function applyPreset(preset: PresetKey) {
    const now = new Date();
    const to = new Date(now);
    let from: Date;
    if (preset === 'today') {
      from = new Date(now);
      from.setHours(0, 0, 0, 0);
    } else {
      const days = PRESETS.find((p) => p.key === preset)?.days ?? 30;
      from = new Date(now.getTime() - days * 86_400_000);
    }
    onChange({
      from: from.toISOString(),
      to: to.toISOString(),
      preset,
    });
  }

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
      <Calendar className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
      {PRESETS.map((p) => {
        const active = value.preset === p.key;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => applyPreset(p.key)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t(`period.${p.key}`)}
          </button>
        );
      })}
    </div>
  );
}

export function defaultPeriod(): Period {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000);
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    preset: '30d',
  };
}
