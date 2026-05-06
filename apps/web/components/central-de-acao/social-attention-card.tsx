'use client';

import Link from 'next/link';
import {
  Megaphone,
  Sparkles,
  Calendar,
  ChevronRight,
} from 'lucide-react';
import { useSocialDashboard } from '@/hooks/use-social';
import { cn } from '@/lib/utils';

/**
 * Bloco "Conteúdo pendente" pra Central de Ação.
 * Mostra contagens do Social AI Studio: pendentes aprovação, agendados
 * próximos 7 dias, rascunhos. Click leva pra /social/biblioteca.
 */
export function SocialAttentionCard() {
  const { counts, loading } = useSocialDashboard(60_000);

  const pending = counts?.pending_approval ?? 0;
  const scheduled = counts?.scheduled_next_7d ?? 0;
  const drafts = counts?.drafts ?? 0;
  const hasAlert = pending > 0 || scheduled > 0;

  return (
    <Link
      href={pending > 0 ? '/social/biblioteca?status=pending_approval' : '/social'}
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-5 transition-colors',
        pending > 0
          ? 'border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60'
          : 'border-border hover:border-border/80',
      )}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone
            className={cn(
              'h-4 w-4',
              pending > 0 ? 'text-amber-500' : 'text-primary',
            )}
          />
          <h2 className="text-sm font-semibold">Social AI — Atenção</h2>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </header>

      {loading && !counts ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : !hasAlert && drafts === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum conteúdo aguardando ação 🎯
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Metric
            icon={Sparkles}
            label="Aguardam aprovação"
            value={pending}
            color={pending > 0 ? 'amber' : 'muted'}
            pulse={pending > 0}
          />
          <Metric
            icon={Calendar}
            label="Agendados (7d)"
            value={scheduled}
            color={scheduled > 0 ? 'blue' : 'muted'}
          />
          <Metric
            icon={Megaphone}
            label="Rascunhos"
            value={drafts}
            color="muted"
          />
        </div>
      )}
    </Link>
  );
}

interface MetricProps {
  icon: typeof Megaphone;
  label: string;
  value: number;
  color: 'amber' | 'blue' | 'muted';
  pulse?: boolean;
}

function Metric({ icon: Icon, label, value, color, pulse }: MetricProps) {
  const colorCls =
    value > 0
      ? color === 'amber'
        ? 'text-amber-600 dark:text-amber-400'
        : color === 'blue'
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-muted-foreground'
      : 'text-muted-foreground';

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-border/60 bg-background/40 p-2',
        pulse && value > 0 && 'animate-pulse',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', colorCls)} />
      <div className="min-w-0">
        <div className={cn('text-base font-semibold leading-none', colorCls)}>{value}</div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}
