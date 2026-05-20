'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { InboxItem } from '@eclick-active/shared';
import { toast } from 'sonner';
import { AvatarWithChannel } from '@/components/contacts/avatar-with-channel';
import { TemperatureBadge } from '@/components/contacts/temperature-badge';
import { conversationsApi } from '@/lib/api/conversations';
import { ApiError } from '@/lib/api/client';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ConversationItemProps {
  item: InboxItem;
  active: boolean;
  onSelect: () => void;
  /** Preview da última mensagem — não vem no v_inbox; passar separado se cacheado. */
  preview?: string | null;
  /** Disparado após toggleStar — pai pode atualizar a lista localmente. */
  onStarChanged?: (id: string, nextStarred: boolean) => void;
}

export function ConversationItem({
  item,
  active,
  onSelect,
  preview,
  onStarChanged,
}: ConversationItemProps) {
  const t = useTranslations('inbox.item');
  const hasUnread = (item.unread_count ?? 0) > 0;
  const [starred, setStarred] = useState(item.is_starred ?? false);
  const [pulsing, setPulsing] = useState(false);

  async function handleToggleStar(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !starred;
    // Optimistic update + animação
    setStarred(next);
    if (next) {
      setPulsing(true);
      setTimeout(() => setPulsing(false), 200);
    }
    onStarChanged?.(item.id, next);
    try {
      await conversationsApi.toggleStar(item.id);
    } catch (err) {
      // Revert on failure
      setStarred(!next);
      onStarChanged?.(item.id, !next);
      toast.error(t('starFailed'), {
        description: err instanceof ApiError ? err.message : t('starFailedRetry'),
      });
    }
  }

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect();
      }}
      className={cn(
        'group relative flex w-full cursor-pointer gap-3 border-b border-border/50 px-3 py-2.5 text-left transition-colors',
        active ? 'bg-card' : 'hover:bg-card/50',
        active && 'border-l-2 border-l-primary',
      )}
    >
      {/* Estrela favorita — canto superior direito */}
      <button
        type="button"
        onClick={handleToggleStar}
        aria-label={starred ? t('starRemove') : t('starAdd')}
        aria-pressed={starred}
        className={cn(
          'absolute right-2 top-2 z-10 inline-flex items-center justify-center rounded-md p-1 transition-all',
          'hover:bg-muted',
          starred
            ? 'text-yellow-400 opacity-100'
            : 'text-muted-foreground opacity-0 group-hover:opacity-100',
        )}
      >
        <Star
          className={cn(
            'h-3.5 w-3.5 transition-transform duration-200',
            pulsing && 'scale-[1.3]',
          )}
          fill={starred ? '#FFC107' : 'none'}
          strokeWidth={starred ? 0 : 2}
        />
      </button>

      {/* Avatar com badge de canal — WhatsApp / Instagram / TikTok / etc */}
      <AvatarWithChannel
        name={item.contact_name}
        src={item.contact_avatar}
        channelType={item.channel_type}
        size="md"
      />

      {/* Conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2 pr-6">
          <span
            className={cn(
              'truncate text-sm',
              hasUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
            )}
          >
            {item.contact_name ?? <span className="italic text-muted-foreground">{t('noName')}</span>}
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
            {preview ?? formatLastMessage(item, t) ?? item.ai_summary ?? t('noMessages')}
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
    </div>
  );
}

/**
 * Formata o preview da última mensagem. Prefixa com "Você:" quando outbound,
 * e mostra "[mídia]" quando plain_text é null mas direction está setado
 * (mensagens de imagem/audio/video/documento).
 */
function formatLastMessage(
  item: InboxItem,
  t: (key: string) => string,
): string | null {
  if (!item.last_message_direction) return null;
  const text = item.last_message_text?.trim() ?? t('mediaFallback');
  const prefix = item.last_message_direction === 'outbound' ? t('youPrefix') : '';
  return prefix + text;
}
