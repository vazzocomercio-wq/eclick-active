'use client';

import Link from 'next/link';
import { Headphones, ExternalLink } from 'lucide-react';
import { useTicketByConversation } from '@/hooks/use-sac';
import {
  PriorityBadge,
  StatusBadge,
  CategoryBadge,
  ReputationRiskBadge,
} from './sac-badges';
import { SlaCountdown } from './sla-countdown';

interface TicketSacSectionProps {
  conversationId: string;
}

/**
 * Card "Ticket SAC" no painel direito da inbox. Aparece SOMENTE se
 * existe ticket aberto vinculado à conversa. Auto-atualiza via socket.
 */
export function TicketSacSection({ conversationId }: TicketSacSectionProps) {
  const { ticket, loading } = useTicketByConversation(conversationId);

  if (loading || !ticket) return null;

  return (
    <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
          <Headphones className="h-3 w-3" />
          Ticket SAC
        </div>
        <Link
          href={`/sac/${ticket.id}`}
          className="inline-flex items-center gap-0.5 text-[11px] text-cyan-700 hover:underline dark:text-cyan-300"
        >
          #{ticket.ticket_number}
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      <div className="flex flex-wrap gap-1">
        <StatusBadge status={ticket.status} />
        <PriorityBadge priority={ticket.priority} />
        <CategoryBadge category={ticket.category} />
        <ReputationRiskBadge level={ticket.reputation_risk_level} />
      </div>

      {ticket.sla_deadline_at && (
        <div className="mt-2 text-[11px]">
          <SlaCountdown deadline={ticket.sla_deadline_at} breached={ticket.sla_breached} compact />
        </div>
      )}

      {ticket.ai_summary && (
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-foreground/80">
          {ticket.ai_summary}
        </p>
      )}

      {(ticket.order_marketplace || ticket.order_marketplace_id) && (
        <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-1.5 text-[10px]">
          <div className="font-medium text-foreground/70">
            {ticket.order_marketplace ?? 'Pedido'}
            {ticket.order_marketplace_id ? ` #${ticket.order_marketplace_id}` : ''}
          </div>
          {ticket.order_status && (
            <div className="text-muted-foreground">{ticket.order_status}</div>
          )}
        </div>
      )}
    </div>
  );
}
