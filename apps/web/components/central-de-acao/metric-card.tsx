'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CountUp } from './count-up';

interface MetricCardProps {
  label: string;
  value: number;
  /** Se true, valor é renderizado como BRL */
  isCurrency?: boolean;
  /** Marca como urgente (badge pulsante) quando value > threshold */
  urgentThreshold?: number;
  icon: LucideIcon;
  iconClassName?: string;
  href: string;
  loading?: boolean;
}

export function MetricCard({
  label,
  value,
  isCurrency,
  urgentThreshold,
  icon: Icon,
  iconClassName,
  href,
  loading,
}: MetricCardProps) {
  const urgent =
    urgentThreshold !== undefined && value > urgentThreshold && !loading;

  return (
    <Link
      href={href}
      className={cn(
        'group relative flex flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card p-5 transition-all',
        'hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5',
        'focus:outline-none focus:ring-2 focus:ring-primary/40',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg',
            iconClassName ?? 'bg-primary/10 text-primary',
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>

      <div className="flex items-end gap-2">
        {loading ? (
          <span className="h-9 w-20 animate-pulse rounded bg-muted" />
        ) : (
          <span className="text-3xl font-semibold tabular-nums">
            {isCurrency ? <CurrencyValue value={value} /> : <CountUp value={value} />}
          </span>
        )}
        {urgent && (
          <span className="mb-1 inline-flex items-center rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            urgente
          </span>
        )}
      </div>
    </Link>
  );
}

function CurrencyValue({ value }: { value: number }) {
  if (value >= 1_000_000) {
    return <>R$ <CountUp value={value / 1_000_000} decimals={1} />M</>;
  }
  if (value >= 10_000) {
    return <>R$ <CountUp value={value / 1_000} decimals={1} />k</>;
  }
  return <>R$ <CountUp value={value} decimals={0} /></>;
}
