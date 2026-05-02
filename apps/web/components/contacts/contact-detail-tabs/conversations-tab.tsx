'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, MessageCircle } from 'lucide-react';
import type { ChannelType, InboxItem } from '@eclick-active/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChatPanel } from '@/components/chat/chat-panel';
import { conversationsApi } from '@/lib/api/conversations';
import { ApiError } from '@/lib/api/client';
import { ChannelIcon } from '@/components/inbox/channel-icon';
import { cn } from '@/lib/utils';

interface ContactConversationsTabProps {
  contactId: string;
}

/**
 * Aba "Conversas" do Contact Detail Sheet. Comportamento:
 *   - Lista todas as conversas do contato (GET /conversations?contact_id=X)
 *   - Se só tem 1 conversa, abre o ChatPanel direto (sem lista)
 *   - Se tem múltiplas, mostra lista clicável; clicar uma abre o ChatPanel
 *     com botão "← Voltar à lista" no topo
 *   - Empty state com hint "Nenhuma conversa registrada"
 */
export function ContactConversationsTab({ contactId }: ContactConversationsTabProps) {
  const [conversations, setConversations] = useState<InboxItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    conversationsApi
      .getByContactId(contactId, ctrl.signal)
      .then((r) => {
        setConversations(r.data);
        // Auto-select se só tiver 1 conversa
        if (r.data.length === 1) setSelected(r.data[0]!.id);
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro ao buscar conversas',
        );
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [contactId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (!conversations || conversations.length === 0) {
    return (
      <Card className="m-4 border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <MessageCircle className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium">Nenhuma conversa registrada</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            As conversas aparecem aqui quando esse contato envia uma mensagem por
            qualquer canal vinculado.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Se uma conversa está selecionada, mostra o ChatPanel
  if (selected) {
    const showBackButton = conversations.length > 1;
    return (
      <div className="flex h-full flex-col">
        {showBackButton && (
          <div className="border-b border-border px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(null)}
              className="h-7 text-xs"
            >
              <ArrowLeft className="mr-1.5 h-3 w-3" />
              Voltar à lista
            </Button>
          </div>
        )}
        <div className="flex-1 overflow-hidden p-3">
          <ChatPanel
            conversationId={selected}
            compact
            showHeader={false}
            className="h-full"
          />
        </div>
      </div>
    );
  }

  // Múltiplas conversas — mostra lista
  return (
    <div className="flex flex-col gap-2 p-4">
      <p className="text-[11px] text-muted-foreground">
        {conversations.length} conversas com esse contato. Selecione uma pra abrir:
      </p>

      {conversations.map((c) => (
        <ConversationListItem
          key={c.id}
          item={c}
          onClick={() => setSelected(c.id)}
        />
      ))}
    </div>
  );
}

function ConversationListItem({
  item,
  onClick,
}: {
  item: InboxItem;
  onClick: () => void;
}) {
  const lastDate = item.last_message_at
    ? new Date(item.last_message_at).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-2 text-left transition-colors',
        'hover:border-primary/40 hover:bg-primary/5',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <ChannelIcon type={item.channel_type as ChannelType} />
          <span className="truncate text-xs font-medium capitalize">
            {item.status}
          </span>
          {item.unread_count > 0 && (
            <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
              {item.unread_count}
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {lastDate}
        </span>
      </div>
      <p className="line-clamp-2 text-[11px] text-muted-foreground">
        {item.ai_summary ?? 'Sem prévia disponível'}
      </p>
    </button>
  );
}
