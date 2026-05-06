'use client';

import { useEffect, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  CreditCard,
  MessageSquare,
  Package,
  StickyNote,
  Truck,
  User,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  whatsappOrdersApi,
  type WhatsAppOrderEvent,
} from '@/lib/api/whatsapp-commerce';
import { cn } from '@/lib/utils';

interface OrderTimelineProps {
  orderId: string;
  /** Polling interval em ms — 0 desliga polling. Default: 0. */
  pollMs?: number;
  className?: string;
}

/**
 * Timeline cronológica de um pedido WhatsApp.
 * Lê de /whatsapp-commerce/orders/:id/events. Mostra status, payments,
 * shippings e mensagens enviadas pela automação.
 */
export function OrderTimeline({
  orderId,
  pollMs = 0,
  className,
}: OrderTimelineProps) {
  const [events, setEvents] = useState<WhatsAppOrderEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function load() {
      try {
        const data = await whatsappOrdersApi.listEvents(orderId, 200);
        if (!cancelled) setEvents(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }
    void load();
    if (pollMs > 0) {
      timer = setInterval(() => void load(), pollMs);
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [orderId, pollMs]);

  if (error) {
    return (
      <div className={cn('text-xs text-destructive', className)}>
        Erro ao carregar timeline: {error}
      </div>
    );
  }
  if (!events) {
    return (
      <div className={cn('text-xs text-muted-foreground', className)}>
        Carregando timeline…
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className={cn('text-xs text-muted-foreground', className)}>
        Nenhum evento registrado.
      </div>
    );
  }

  return (
    <ol className={cn('relative space-y-3 border-l border-border pl-4', className)}>
      {events.map((e) => {
        const v = visualForEvent(e.event_type);
        const Icon = v.icon;
        return (
          <li key={e.id} className="relative">
            <span
              className={cn(
                'absolute -left-[26px] flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background',
                v.color,
              )}
            >
              <Icon className="h-3 w-3" />
            </span>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">{v.label}</span>
                <span className="text-muted-foreground">
                  {formatRelative(e.created_at)}
                </span>
                <ActorBadge actor={e.actor_type} />
              </div>
              {e.description && (
                <div className="text-xs text-muted-foreground line-clamp-3">
                  {e.description}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

interface EventVisual {
  icon: LucideIcon;
  color: string;
  label: string;
}

function visualForEvent(type: string): EventVisual {
  if (type.startsWith('status:')) {
    const status = type.slice(7);
    if (status === 'cancelled' || status === 'refunded') {
      return { icon: XCircle, color: 'text-destructive', label: rotuloStatus(status) };
    }
    if (status === 'delivered') {
      return { icon: CheckCircle2, color: 'text-emerald-500', label: rotuloStatus(status) };
    }
    return { icon: Package, color: 'text-blue-400', label: rotuloStatus(status) };
  }
  if (type.startsWith('payment:')) {
    const p = type.slice(8);
    return {
      icon: CreditCard,
      color: p === 'paid' ? 'text-emerald-500' : 'text-amber-400',
      label: rotuloPayment(p),
    };
  }
  if (type.startsWith('shipping:')) {
    return {
      icon: Truck,
      color: 'text-cyan-400',
      label: rotuloShipping(type.slice(9)),
    };
  }
  if (type.startsWith('message:')) {
    return {
      icon: MessageSquare,
      color: 'text-blue-400',
      label: rotuloMessage(type.slice(8)),
    };
  }
  if (type === 'note') {
    return { icon: StickyNote, color: 'text-yellow-400', label: 'Anotação' };
  }
  return { icon: StickyNote, color: 'text-muted-foreground', label: type };
}

function rotuloStatus(s: string): string {
  switch (s) {
    case 'pending': return 'Pendente';
    case 'confirmed': return 'Confirmado';
    case 'processing': return 'Processando';
    case 'shipped': return 'Enviado';
    case 'delivered': return 'Entregue';
    case 'cancelled': return 'Cancelado';
    case 'refunded': return 'Reembolsado';
    default: return s;
  }
}
function rotuloPayment(s: string): string {
  switch (s) {
    case 'pending': return 'Pagamento pendente';
    case 'paid': return 'Pagamento confirmado';
    case 'failed': return 'Pagamento falhou';
    case 'refunded': return 'Pagamento estornado';
    case 'cancelled': return 'Pagamento cancelado';
    default: return s;
  }
}
function rotuloShipping(s: string): string {
  switch (s) {
    case 'pending': return 'Envio pendente';
    case 'processing': return 'Preparando envio';
    case 'shipped': return 'Despachado';
    case 'in_transit': return 'Em trânsito';
    case 'delivered': return 'Entregue ao cliente';
    case 'returned': return 'Devolvido';
    default: return s;
  }
}
function rotuloMessage(kind: string): string {
  switch (kind) {
    case 'order_update': return 'Atualização enviada';
    case 'tracking': return 'Rastreio enviado';
    case 'review_request': return 'Pediu review';
    case 'reorder_suggestion': return 'Sugeriu recompra';
    case 'manual': return 'Mensagem manual';
    default: return `Mensagem (${kind})`;
  }
}

function ActorBadge({ actor }: { actor: WhatsAppOrderEvent['actor_type'] }) {
  const map: Record<WhatsAppOrderEvent['actor_type'], { label: string; icon: LucideIcon; color: string }> = {
    system: { label: 'sistema', icon: Bot, color: 'text-muted-foreground' },
    automation: { label: 'automação', icon: Bot, color: 'text-purple-400' },
    agent: { label: 'agente', icon: User, color: 'text-blue-400' },
    ai: { label: 'IA', icon: Bot, color: 'text-emerald-400' },
    customer: { label: 'cliente', icon: User, color: 'text-cyan-400' },
    webhook: { label: 'webhook', icon: Bot, color: 'text-orange-400' },
  };
  const v = map[actor];
  const Icon = v.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border px-1 py-0 text-[9px] uppercase tracking-wide',
        v.color,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {v.label}
    </span>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMin = (Date.now() - d.getTime()) / 60_000;
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${Math.round(diffMin)}min atrás`;
  if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}h atrás`;
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
