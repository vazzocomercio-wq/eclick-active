'use client';

import { ArrowLeft, CheckCheck, MoreVertical, PanelRightClose, PanelRightOpen, UserPlus } from 'lucide-react';
import type { ConversationDetail } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { AvatarWithChannel } from '@/components/contacts/avatar-with-channel';
import { TemperatureBadge } from '@/components/contacts/temperature-badge';
import { channelLabel } from '@/components/ui/channel-icon';
import { formatPhone } from '@/lib/format';

interface ChatHeaderProps {
  conversation: ConversationDetail | null;
  onResolve?: () => void;
  onAssign?: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  /** Em mobile, callback pra voltar pra lista. Quando passado, exibe botão. */
  onBack?: () => void;
}

export function ChatHeader({
  conversation,
  onResolve,
  onAssign,
  panelOpen,
  onTogglePanel,
  onBack,
}: ChatHeaderProps) {
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
            aria-label="Voltar para lista"
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
              {contact?.name ?? <span className="italic text-muted-foreground">sem nome</span>}
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onAssign}
          className="hidden gap-1.5 sm:inline-flex"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Atribuir
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onResolve}
          disabled={isResolved}
          className="hidden gap-1.5 sm:inline-flex"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          {isResolved ? 'Resolvida' : 'Resolver'}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Mais ações">
          <MoreVertical className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onTogglePanel}
          aria-label={panelOpen ? 'Fechar painel' : 'Abrir painel'}
          className="hidden lg:inline-flex"
        >
          {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  );
}
