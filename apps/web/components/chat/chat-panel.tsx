'use client';

import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { ConversationDetail } from '@eclick-active/shared';
import { conversationsApi } from '@/lib/api/conversations';
import { useChat } from '@/hooks/use-chat';
import { useEvents } from '@/hooks/use-events';
import { ChatHeader } from '@/components/inbox/chat-header';
import { TransferBriefingBanner } from '@/components/inbox/transfer-briefing-banner';
import { MessageList } from '@/components/inbox/message-list';
import { MessageInput } from '@/components/inbox/message-input';
import { AISuggestionBar } from '@/components/inbox/ai-suggestion-bar';
import { ChatActions, type ChatActionEvent } from './chat-actions';
import { InlineAISummary } from './inline-ai-summary';
import { cn } from '@/lib/utils';

interface AISuggestion {
  text: string;
  confidence?: number;
  ai_interaction_id?: string;
  live_sources_used?: Array<{ id: string; name: string; url: string }>;
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

  /**
   * Callback genérico pra ações do ChatActions (resolve/resumir/criar tarefa
   * /etc.) — drawer pai pode reagir, ex: refresh do deal após resolve.
   */
  onAction?: (event: ChatActionEvent) => void;

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
  onAction,
  className,
}: ChatPanelProps) {
  // Default: header em full, sem header em compact (drawer já tem o seu)
  const headerVisible = showHeader ?? !compact;

  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [prefill, setPrefill] = useState<string>('');
  /** Resumo gerado AGORA via "Resumir" — toma precedência sobre `detail.ai_summary`. */
  const [freshSummary, setFreshSummary] = useState<string | null>(null);
  /** Permite o usuário dispensar o card de resumo até o próximo "Resumir" ou troca de conversa. */
  const [summaryDismissed, setSummaryDismissed] = useState(false);

  const chat = useChat(conversationId);

  // Carrega detalhe da conversa pra header + contact panel
  useEffect(() => {
    if (!conversationId) {
      setDetail(null);
      setFreshSummary(null);
      setSummaryDismissed(false);
      return;
    }
    // Trocou de conversa — limpa estado efêmero
    setFreshSummary(null);
    setSummaryDismissed(false);
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
        ...(payload.live_sources_used ? { live_sources_used: payload.live_sources_used } : {}),
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

      {/* Card inline de resumo IA — aparece quando há ai_summary persistido
          OU quando "Resumir" foi clicado. Posicionado entre as mensagens e
          o input pra ficar sempre visível sem competir com a leitura. */}
      {!summaryDismissed && (freshSummary ?? detail?.ai_summary) && (
        <InlineAISummary
          summary={freshSummary ?? detail?.ai_summary ?? ''}
          fresh={!!freshSummary}
          generatedAt={detail?.updated_at ?? null}
          intent={detail?.ai_intent ?? null}
          sentiment={detail?.ai_sentiment ?? null}
          temperature={detail?.ai_temperature ?? null}
          onDismiss={() => setSummaryDismissed(true)}
          compact={compact}
        />
      )}

      {showActions && (
        <ChatActions
          conversation={detail}
          compact={compact}
          onUpdated={(patch) => {
            setDetail((d) => (d ? ({ ...d, ...patch } as ConversationDetail) : d));
          }}
          onSummary={(summary) => {
            setFreshSummary(summary);
            setSummaryDismissed(false);
          }}
          onAction={onAction}
        />
      )}

      <AISuggestionBar
        suggestion={aiSuggestion?.text ?? null}
        confidence={aiSuggestion?.confidence}
        aiInteractionId={aiSuggestion?.ai_interaction_id ?? null}
        liveSourcesUsed={aiSuggestion?.live_sources_used}
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
