'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Sparkles, X } from 'lucide-react';
import type { ConversationDetail } from '@eclick-active/shared';
import { conversationsApi } from '@/lib/api/conversations';
import { useChat } from '@/hooks/use-chat';
import { useEvents } from '@/hooks/use-events';
import { ChatHeader } from '@/components/inbox/chat-header';
import { TransferBriefingBanner } from '@/components/inbox/transfer-briefing-banner';
import { MessageList } from '@/components/inbox/message-list';
import { MessageInput } from '@/components/inbox/message-input';
import { AISuggestionBar } from '@/components/inbox/ai-suggestion-bar';
import { ChatActions } from './chat-actions';
import { cn } from '@/lib/utils';

interface AISuggestion {
  text: string;
  confidence?: number;
  ai_interaction_id?: string;
}

export interface ChatPanelProps {
  /** Conversa atualmente carregada. `null` mostra estado vazio. */
  conversationId: string | null;

  /**
   * Modo compacto: usado quando ChatPanel está dentro de drawers (deal-detail,
   * contact-detail, etc.). Aplica `max-h-[400px]`, esconde header por padrão e
   * encolhe o input. Em modo full (false), ocupa todo espaço disponível.
   */
  compact?: boolean;

  /**
   * Mostrar o header do chat (avatar, nome, ações resolver/atribuir, toggle do
   * painel lateral). Padrão = `!compact` — drawers já têm o próprio cabeçalho.
   */
  showHeader?: boolean;

  /**
   * Mostrar barra de ações do header (Resolver/Atribuir). Não tem efeito
   * quando `showHeader` é false. Padrão = `true`.
   */
  showActions?: boolean;

  /**
   * Estado do painel lateral (3ª coluna do inbox). Só faz sentido em modo
   * full + showHeader. Quando ausente, o botão de toggle não aparece.
   */
  panelOpen?: boolean;
  onTogglePanel?: () => void;

  /**
   * Callback disparado quando o detalhe da conversa carrega — usado pelo
   * inbox pra sincronizar o ContactPanel da 3ª coluna.
   */
  onConversationLoad?: (c: ConversationDetail) => void;

  /** Classes extras no container raiz. */
  className?: string;
}

/**
 * Painel de chat reutilizável — extraído do inbox antigo (`chat-view.tsx`).
 *
 * Responsabilidades:
 *  - Carrega `ConversationDetail` (header) via `conversationsApi.getById`
 *  - Usa `useChat(conversationId)` pra mensagens com cursor pagination + Realtime
 *  - Marca conversa como lida 1s após abrir
 *  - Escuta eventos `ai:suggestion` via WebSocket pra preencher AISuggestionBar
 *  - Renderiza header opcional, lista de mensagens, sugestão IA, input
 *
 * Modos:
 *  - `compact=false` (default): ocupa altura toda do parent, com header.
 *    Usado pelo `/conversas` (3 colunas).
 *  - `compact=true`: max-h 400px com scroll, sem header, input compacto.
 *    Usado dentro de drawers (deal-detail, contact-detail).
 */
export function ChatPanel({
  conversationId,
  compact = false,
  showHeader,
  showActions = true,
  panelOpen,
  onTogglePanel,
  onConversationLoad,
  className,
}: ChatPanelProps) {
  // Default: header em full, sem header em compact (drawer já tem o seu)
  const headerVisible = showHeader ?? !compact;

  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [prefill, setPrefill] = useState<string>('');
  /** Resumo gerado pela IA — exibido como "mensagem especial" no chat
   * (efêmero; é descartado ao trocar de conversa). A persistência fica
   * em `conversation.ai_summary` no backend. */
  const [aiSummaryEphemeral, setAiSummaryEphemeral] = useState<string | null>(null);

  const chat = useChat(conversationId);

  // Carrega detalhe da conversa pra header + contact panel
  useEffect(() => {
    if (!conversationId) {
      setDetail(null);
      setAiSummaryEphemeral(null);
      return;
    }
    // Trocou de conversa — limpa resumo efêmero
    setAiSummaryEphemeral(null);
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

  // Eventos custom (ai:suggestion) via WebSocket
  useEvents({
    onAISuggestion: (payload) => {
      if (payload.conversation_id !== conversationId) return;
      setAiSuggestion({
        text: payload.suggestion,
        confidence: payload.confidence,
        ...(payload.ai_interaction_id ? { ai_interaction_id: payload.ai_interaction_id } : {}),
      });
    },
  });

  if (!conversationId) {
    return <EmptyChatState compact={compact} className={className} />;
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
    <div
      className={cn(
        'flex flex-col bg-background',
        compact ? 'max-h-[400px] rounded-md border border-border' : 'h-full',
        className,
      )}
    >
      {headerVisible && (
        <ChatHeader
          conversation={detailLoading ? null : detail}
          onResolve={showActions ? handleResolve : undefined}
          panelOpen={panelOpen ?? false}
          onTogglePanel={onTogglePanel ?? (() => {})}
        />
      )}

      <TransferBriefingBanner conversation={detailLoading ? null : detail} />

      <MessageList
        messages={chat.messages}
        loading={chat.loading}
        hasMore={chat.hasMore}
        loadingMore={chat.loadingMore}
        onLoadMore={() => {
          void chat.loadMore();
        }}
      />

      {aiSummaryEphemeral && (
        <SummaryBubble
          summary={aiSummaryEphemeral}
          onDismiss={() => setAiSummaryEphemeral(null)}
        />
      )}

      {showActions && (
        <ChatActions
          conversation={detail}
          onUpdated={(patch) => {
            setDetail((d) => (d ? ({ ...d, ...patch } as ConversationDetail) : d));
          }}
          onSummary={(summary) => setAiSummaryEphemeral(summary)}
        />
      )}

      <AISuggestionBar
        suggestion={aiSuggestion?.text ?? null}
        confidence={aiSuggestion?.confidence}
        aiInteractionId={aiSuggestion?.ai_interaction_id ?? null}
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
        compact={compact}
      />
    </div>
  );
}

/**
 * Bolha especial pro resumo gerado pela IA. Aparece imediatamente após o
 * `ChatActions.Resumir` retornar — visualmente é uma "mensagem do sistema"
 * dentro do fluxo do chat, com badge "✨ Resumo IA" e botão de dispensar.
 *
 * Não é persistida (a versão persistente vive em `conversation.ai_summary`).
 */
function SummaryBubble({ summary, onDismiss }: { summary: string; onDismiss: () => void }) {
  return (
    <div className="border-t border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Sparkles className="h-3 w-3" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              Resumo IA
            </span>
            <span className="text-[10px] text-muted-foreground">recém gerado</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{summary}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dispensar resumo"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function EmptyChatState({ compact, className }: { compact: boolean; className?: string }) {
  if (compact) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background/50 p-6 text-center text-xs text-muted-foreground',
          className,
        )}
      >
        <MessageSquare className="h-5 w-5" />
        <p>Sem conversa carregada</p>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center gap-3 bg-background p-8 text-center',
        className,
      )}
    >
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
