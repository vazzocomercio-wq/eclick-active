'use client';

import {
  AtSign,
  Facebook,
  Instagram,
  Megaphone,
  MessageCircle,
  Music2,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';
import {
  CHANNEL_COLOR,
  type ContentCalendarEvent,
  type ContentChannel,
} from '@/lib/api/content-calendar';
import { cn } from '@/lib/utils';

const CHANNEL_ICON: Record<ContentChannel, LucideIcon> = {
  instagram: Instagram,
  facebook: Facebook,
  tiktok: Music2,
  whatsapp: MessageCircle,
  email: AtSign,
  meta_ads: Target,
  google_ads: Megaphone,
};

interface EventCardProps {
  event: ContentCalendarEvent;
  /** Card compacto pra grade do mês (só ícone + horário). */
  compact?: boolean;
  /** Borda cyan-glow quando o card representa "hoje". */
  isToday?: boolean;
  onClick?: () => void;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  draggable?: boolean;
  className?: string;
}

/**
 * Card único de evento — usado nas 3 views (mês compacto, semana com hora,
 * lista expandida). Estilo: pílula colorida com a cor do canal.
 */
export function EventCard({
  event,
  compact = false,
  isToday = false,
  onClick,
  onDragStart,
  draggable = false,
  className,
}: EventCardProps) {
  const color = event.color ?? CHANNEL_COLOR[event.channel];
  const Icon = CHANNEL_ICON[event.channel];

  const hasProductLink = !!event.product_id;
  const productSnap =
    (event.resource_snapshot?.product as
      | { name?: string; thumbnail_url?: string | null }
      | undefined) ?? undefined;

  const isPastUnpublished = isPastUnpublishedEvent(event);

  const time = event.scheduled_time
    ? event.scheduled_time.slice(0, 5)
    : null;

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onClick) {
          e.preventDefault();
          onClick();
        }
      }}
      draggable={draggable}
      onDragStart={onDragStart}
      className={cn(
        'group flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors',
        'min-h-[36px] sm:min-h-[44px]',
        isToday && 'ring-1 ring-cyan-400 ring-offset-1 ring-offset-background',
        isPastUnpublished && 'opacity-60',
        onClick && 'cursor-pointer hover:bg-accent/50',
        draggable && 'cursor-grab active:cursor-grabbing',
        className,
      )}
      style={{
        borderColor: `${color}66`,
        backgroundColor: `${color}14`,
      }}
    >
      <Icon
        className={cn('shrink-0', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')}
        style={{ color }}
      />

      <div className="flex min-w-0 flex-1 items-center gap-1">
        {time && (
          <span
            className={cn(
              'shrink-0 font-mono tabular-nums',
              compact ? 'text-[10px]' : 'text-xs',
            )}
            style={{ color }}
          >
            {time}
          </span>
        )}
        <span
          className={cn(
            'truncate',
            compact ? 'text-[11px]' : 'text-xs',
            'text-foreground',
          )}
          title={event.title}
        >
          {event.title}
        </span>
      </div>

      {hasProductLink && !compact && (
        <span
          className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[9px] text-amber-300"
          title={productSnap?.name ?? 'Produto vinculado'}
        >
          {productSnap?.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={productSnap.thumbnail_url}
              alt=""
              className="h-3 w-3 rounded-full object-cover"
            />
          ) : (
            <Sparkles className="h-2.5 w-2.5" />
          )}
          <span className="max-w-[70px] truncate">
            {productSnap?.name ?? 'Produto'}
          </span>
        </span>
      )}

      {isPastUnpublished && !compact && (
        <span className="shrink-0 rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0 text-[9px] text-rose-300">
          atrasado
        </span>
      )}
    </div>
  );
}

function isPastUnpublishedEvent(event: ContentCalendarEvent): boolean {
  if (event.status === 'published') return false;
  if (event.status === 'cancelled') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const scheduled = new Date(event.scheduled_date + 'T00:00:00');
  return scheduled < today;
}
