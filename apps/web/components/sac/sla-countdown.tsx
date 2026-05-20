'use client';

import { useEffect, useState } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

interface SlaCountdownProps {
  /** ISO timestamp do deadline. Null = sem SLA. */
  deadline: string | null;
  /** Já vencido? Quando true, mostra "vencido" em vermelho. */
  breached?: boolean;
  className?: string;
  /** Compact mode pra caber em chips de painel. */
  compact?: boolean;
}

/**
 * Countdown ao vivo até o deadline de SLA. Atualiza a cada 30s.
 * Cores: verde (>1h), amarelo (<1h), vermelho (<30min ou breached).
 */
export function SlaCountdown({ deadline, breached, className, compact }: SlaCountdownProps) {
  const t = useTranslations('sac.sla');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!deadline) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-[11px] text-muted-foreground', className)}>
        <Clock className="h-3 w-3" />
        {t('none')}
      </span>
    );
  }

  const target = new Date(deadline).getTime();
  const remainingMs = target - now;

  let label: string;
  let color: string;
  let Icon = Clock;

  if (breached || remainingMs < 0) {
    const overMs = Math.abs(remainingMs);
    label = t('breachedAgo', { duration: formatDuration(overMs) });
    color = 'text-red-600 dark:text-red-400';
    Icon = AlertTriangle;
  } else if (remainingMs < 30 * 60_000) {
    label = `${formatDuration(remainingMs)}`;
    color = 'text-red-600 dark:text-red-400 animate-pulse';
  } else if (remainingMs < 60 * 60_000) {
    label = `${formatDuration(remainingMs)}`;
    color = 'text-amber-600 dark:text-amber-400';
  } else {
    label = `${formatDuration(remainingMs)}`;
    color = 'text-emerald-600 dark:text-emerald-400';
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium',
        compact ? 'text-[11px]' : 'text-xs',
        color,
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}

function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m > 0 ? `${h}h${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH > 0 ? `${d}d${remH}h` : `${d}d`;
}
