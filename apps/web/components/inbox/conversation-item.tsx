'use client';

import type { InboxItem } from '@eclick-active/shared';
import { InitialsAvatar } from '@/components/contacts/initials-avatar';
import { TemperatureBadge } from '@/components/contacts/temperature-badge';
import { ChannelIcon } from './channel-icon';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ConversationItemProps {
  item: InboxItem;
  active: boolean;
  onSelect: () => void;
  /** Preview da última mensagem — não vem no v_inbox; passar separado se cacheado. */
  preview?: string | null;
}

export function ConversationItem({ item, active, onSelect, preview }: ConversationItemProps) {
  const hasUnread = (item.unread_count ?? 0) > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full gap-3 border-b border-border/50 px-3 py-2.5 text-left transition-colors',
        active ? 'bg-card' : 'hover:bg-card/50',
        active && 'border-l-2 border-l-primary',
      )}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <InitialsAvatar
          name={item.contact_name}
          src={item.contact_avatar}
          className="h-10 w-10 text-xs"
        />
        <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <ChannelIcon type={item.channel_type} className="h-3 w-3" />
        </span>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'truncate text-sm',
              hasUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
            )}
          >
            {item.contact_name ?? <span className="italic text-muted-foreground">sem nome</span>}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatRelativeTime(item.last_message_at)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'truncate text-xs',
              hasUnread ? 'text-foreground/80' : 'text-muted-foreground',
            )}
          >
            {preview ?? item.ai_summary ?? 'Sem mensagens'}
          </span>
          {hasUnread && (
            <span className="inline-flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {item.unread_count > 99 ? '99+' : item.unread_count}
            </span>
          )}
        </div>

        {item.contact_temperature && (
          <div className="mt-0.5">
            <TemperatureBadge temperature={item.contact_temperature} />
          </div>
        )}
      </div>
    </button>
  );
}
