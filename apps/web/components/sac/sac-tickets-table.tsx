'use client';

import Link from 'next/link';
import { Headphones, MessageSquare, Mail, Phone, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SacTicket } from '@/lib/api/sac';
import {
  PriorityBadge,
  StatusBadge,
  CategoryBadge,
  ReputationRiskBadge,
} from './sac-badges';
import { SlaCountdown } from './sla-countdown';

const CHANNEL_ICONS: Record<string, typeof Headphones> = {
  whatsapp: MessageSquare,
  whatsapp_baileys: MessageSquare,
  whatsapp_zapi: MessageSquare,
  email: Mail,
  instagram: Globe,
  tiktok: Globe,
  form: Globe,
  phone: Phone,
};

interface SacTicketsTableProps {
  tickets: SacTicket[];
  loading?: boolean;
  emptyMessage?: string;
  compact?: boolean;
}

export function SacTicketsTable({ tickets, loading, emptyMessage, compact }: SacTicketsTableProps) {
  if (loading && tickets.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Carregando tickets…
      </div>
    );
  }
  if (!loading && tickets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
        <Headphones className="mx-auto mb-2 h-6 w-6 opacity-50" />
        {emptyMessage ?? 'Nenhum ticket encontrado'}
      </div>
    );
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-card', compact && 'text-sm')}>
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Prioridade</th>
            <th className="px-3 py-2 text-left">Categoria</th>
            <th className="hidden px-3 py-2 text-left md:table-cell">SLA</th>
            <th className="hidden px-3 py-2 text-left lg:table-cell">Risco</th>
            <th className="hidden px-3 py-2 text-left lg:table-cell">Canal</th>
            <th className="hidden px-3 py-2 text-left xl:table-cell">Criado</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => {
            const ChannelIcon = t.source_channel ? (CHANNEL_ICONS[t.source_channel] ?? Globe) : null;
            return (
              <tr
                key={t.id}
                className="border-b border-border/60 hover:bg-muted/20"
              >
                <td className="px-3 py-2 align-middle">
                  <Link
                    href={`/sac/${t.id}`}
                    className="font-mono text-xs font-medium text-primary hover:underline"
                  >
                    #{t.ticket_number}
                  </Link>
                  {t.is_preventive && (
                    <span className="ml-1 inline-flex items-center rounded-sm bg-cyan-500/15 px-1 text-[9px] font-medium uppercase text-cyan-700 dark:text-cyan-300">
                      Prev
                    </span>
                  )}
                  {t.created_by_ai && !t.is_preventive && (
                    <span className="ml-1 inline-flex items-center rounded-sm bg-violet-500/15 px-1 text-[9px] font-medium uppercase text-violet-700 dark:text-violet-300">
                      IA
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 align-middle">
                  <StatusBadge status={t.status} />
                </td>
                <td className="px-3 py-2 align-middle">
                  <PriorityBadge priority={t.priority} />
                </td>
                <td className="px-3 py-2 align-middle">
                  <CategoryBadge category={t.category} />
                </td>
                <td className="hidden px-3 py-2 align-middle md:table-cell">
                  <SlaCountdown deadline={t.sla_deadline_at} breached={t.sla_breached} compact />
                </td>
                <td className="hidden px-3 py-2 align-middle lg:table-cell">
                  <ReputationRiskBadge level={t.reputation_risk_level} />
                </td>
                <td className="hidden px-3 py-2 align-middle lg:table-cell">
                  {ChannelIcon && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <ChannelIcon className="h-3 w-3" />
                      {t.source_channel}
                    </span>
                  )}
                </td>
                <td className="hidden px-3 py-2 align-middle text-xs text-muted-foreground xl:table-cell">
                  {formatDate(t.created_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const diff = today.getTime() - d.getTime();
    const min = Math.floor(diff / 60_000);
    if (min < 1) return 'agora';
    if (min < 60) return `${min}m atrás`;
    if (min < 1440) return `${Math.floor(min / 60)}h atrás`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  } catch {
    return iso;
  }
}
