'use client';

import type { ChannelType } from '@eclick-active/shared';
import { InitialsAvatar } from '@/components/contacts/initials-avatar';
import { ChannelIcon } from '@/components/ui/channel-icon';
import { cn } from '@/lib/utils';

interface AvatarWithChannelProps {
  name: string | null;
  src?: string | null;
  channelType?: ChannelType | null;
  /** Tamanho do avatar — controla também o tamanho do badge */
  size?: 'sm' | 'md' | 'lg';
  /** Mostra tooltip do canal on hover */
  channelTooltip?: boolean;
  className?: string;
}

const SIZE_MAP = {
  sm: {
    avatar: 'h-9 w-9 text-xs',
    badge: 'h-[18px] w-[18px] -bottom-0.5 -right-0.5',
    icon: 'h-3 w-3',
  },
  md: {
    avatar: 'h-10 w-10 text-xs',
    badge: 'h-5 w-5 -bottom-0.5 -right-0.5',
    icon: 'h-3.5 w-3.5',
  },
  lg: {
    avatar: 'h-12 w-12 text-sm',
    badge: 'h-6 w-6 -bottom-1 -right-1',
    icon: 'h-4 w-4',
  },
} as const;

/**
 * Avatar do contato com badge sobreposto mostrando o ícone do canal da
 * conversa atual (WhatsApp / Instagram / TikTok / etc).
 *
 * Padrão visual igual ao WhatsApp Web / Telegram: bolinha branca/dark no
 * canto inferior direito do avatar com o ícone colorido na cor da marca
 * do canal.
 *
 * Reutilizável em:
 *   - Lista de conversas (item) — size sm
 *   - Header do chat — size md
 *   - Painel do contato — size lg
 *
 * Se `channelType` não vier, renderiza apenas o avatar sem badge.
 */
export function AvatarWithChannel({
  name,
  src,
  channelType,
  size = 'md',
  channelTooltip = true,
  className,
}: AvatarWithChannelProps) {
  const sz = SIZE_MAP[size];
  return (
    <div className={cn('relative shrink-0', className)}>
      <InitialsAvatar name={name} src={src} className={sz.avatar} />
      {channelType && (
        <span
          className={cn(
            'absolute inline-flex items-center justify-center rounded-full bg-background ring-2 ring-border',
            sz.badge,
          )}
          aria-hidden={!channelTooltip}
        >
          <ChannelIcon
            type={channelType}
            size="sm"
            tooltip={channelTooltip}
            className={sz.icon}
          />
        </span>
      )}
    </div>
  );
}
