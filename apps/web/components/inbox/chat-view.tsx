'use client';

import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { ConversationDetail } from '@eclick-active/shared';
import { conversationsApi } from '@/lib/api/conversations';
import { useChat } from '@/hooks/use-chat';
import { useEvents } from '@/hooks/use-events';
import { ChatHeader } from './chat-header';
import { MessageList } from './message-list';
import { MessageInput } from './message-input';
import { AISuggestionBar } from './ai-suggestion-bar';

interface ChatViewProps {
  conversationId: string | null;
  panelOpen: boolean;
  onTogglePanel: () => void;
  /** Callback quando muda detalhe (pra Contact Panel sincronizar) */
  onConversationLoad?: (c: ConversationDetail) => void;
}

interface AISuggestion {
  text: string;
  confidence?: number;
}

export function ChatView({
  conversationId,
  panelOpen,
  onTogglePanel,
  onConversationLoad,
}: ChatViewProps) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [prefill, setPrefill] = useState<string>('');

  const chat = useChat(conversationId);

  // Carrega detalhe da conversa pra header + contact panel
  useEffect(() => {
    if (!conversationId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    let cancelled = false;
    conversationsApi
      .getById(conversationId)
      .then((c) => {
        if (cancelled) return;
        setDetail(c);
        onConversationLoad?.(c);
      })
      .catch(() => {
        if (cancelled) return;
        setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, onConversationLoad]);

  // Marca como lida ao abrir (best-effort, não bloqueia render)
  useEffect(() => {
    if (!conversationId) return;
    const t = setTimeout(() => {
      void conversationsApi.markAsRead(conversationId).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [conversationId]);

  // Eventos custom (ai:suggestion) via WebSocket — placeholder por enquanto
  useEvents({
    onAISuggestion: (payload) => {
      if (payload.conversation_id !== conversationId) return;
      setAiSuggestion({ text: payload.suggestion, confidence: payload.confidence });
    },
  });

  if (!conversationId) {
    return <EmptyChatState />;
  }

  async function handleSend(text: string, isInternalNote: boolean) {
    await chat.send(text, isInternalNote);
  }

  async function handleResolve() {
    if (!conversationId) return;
    try {
      const updated = await conversationsApi.update(conversationId, { status: 'resolved' });
      setDetail((d) => (d ? { ...d, ...updated } : d));
    } catch (err) {
      console.error('Failed to resolve:', err);
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <ChatHeader
        conversation={detailLoading ? null : detail}
        onResolve={handleResolve}
        panelOpen={panelOpen}
        onTogglePanel={onTogglePanel}
      />

      <MessageList
        messages={chat.messages}
        loading={chat.loading}
        hasMore={chat.hasMore}
        loadingMore={chat.loadingMore}
        onLoadMore={() => {
          void chat.loadMore();
        }}
      />

      <AISuggestionBar
        suggestion={aiSuggestion?.text ?? null}
        confidence={aiSuggestion?.confidence}
        onUse={() => {
          if (aiSuggestion) {
            setPrefill(aiSuggestion.text);
            setAiSuggestion(null);
          }
        }}
        onEdit={() => {
          if (aiSuggestion) {
            setPrefill(aiSuggestion.text);
            setAiSuggestion(null);
          }
        }}
        onIgnore={() => setAiSuggestion(null)}
      />

      <MessageInput
        onSend={handleSend}
        disabled={chat.loading}
        prefill={prefill}
        onPrefillConsumed={() => setPrefill('')}
      />
    </div>
  );
}

function EmptyChatState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card">
        <MessageSquare className="h-8 w-8 text-muted-foreground" />
      </div>
      <p className="text-base font-medium">Nenhuma conversa selecionada</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Escolha uma conversa na lista ao lado pra começar a responder.
      </p>
    </div>
  );
}
