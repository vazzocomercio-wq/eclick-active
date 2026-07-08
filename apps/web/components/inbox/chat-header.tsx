'use client';

import { ArrowLeft, CheckCheck, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ConversationDetail } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { AvatarWithChannel } from '@/components/contacts/avatar-with-channel';
import { TemperatureBadge } from '@/components/contacts/temperature-badge';
import { channelLabel } from '@/components/ui/channel-icon';
import { formatPhone } from '@/lib/format';

interface ChatHeaderProps {
  conversation: ConversationDetail | null;
  onResolve?: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  /** Em mobile, callback pra voltar pra lista. Quando passado, exibe botão. */
  onBack?: () => void;
}

export function ChatHeader({
  conversation,
  onResolve,
  panelOpen,
  onTogglePanel,
  onBack,
}: ChatHeaderProps) {
  const t = useTranslations('inbox.chatHeader');
  if (!conversation) {
    return <div className="h-16 border-b border-border" />;
  }

  const contact = conversation.contact;
  const isResolved = conversation.status === 'resolved' || conversation.status === 'closed';

  return (
    <header className="flex h-16 items-center justify-between gap-3 border-b border-border px-4">
      <div className="flex items-center gap-3 min-w-0">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t('backAria')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <AvatarWithChannel
          name={contact?.name ?? null}
          src={contact?.avatar_url}
          channelType={conversation.channel_type}
          size="md"
        />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-semibold">
              {contact?.name ?? <span className="italic text-muted-foreground">{t('noName')}</span>}
            </span>
            {contact?.temperature && <TemperatureBadge temperature={contact.temperature} />}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{contact?.phone ? formatPhone(contact.phone) : '—'}</span>
            <span>·</span>
            <span>{channelLabel(conversation.channel_type)}</span>
            <span>·</span>
            <span className="capitalize">{conversation.status}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {onResolve && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onResolve}
            disabled={isResolved}
            className="hidden gap-1.5 sm:inline-flex"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            {isResolved ? t('resolved') : t('resolve')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onTogglePanel}
          aria-label={panelOpen ? t('closePanel') : t('openPanel')}
          className="hidden lg:inline-flex"
        >
          {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  );
}
