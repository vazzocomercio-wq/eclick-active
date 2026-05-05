'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Sparkles } from 'lucide-react';
import type { ConversationDetail } from '@eclick-active/shared';
import { conversationsApi } from '@/lib/api/conversations';
import { useChat } from '@/hooks/use-chat';
import { useEvents } from '@/hooks/use-events';
import { getSocket } from '@/lib/realtime/socket-client';
import { ChatHeader } from '@/components/inbox/chat-header';
import { TransferBriefingBanner } from '@/components/inbox/transfer-briefing-banner';
import { MessageList } from '@/components/inbox/message-list';
import { MessageInput } from '@/components/inbox/message-input';
import { AISuggestionBar } from '@/components/inbox/ai-suggestion-bar';
import { ChatActions, type ChatActionEvent } from './chat-actions';
import { InlineAISummary } from './inline-ai-summary';
import { AIInsightsCard } from './ai-insights-card';
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
  /** Trigger refetch dos gaps — incrementa quando uma nova mensagem chega
   *  (debounced 30s pra não chamar IA a cada turn). */
  const [gapsRefreshKey, setGapsRefreshKey] = useState(0);

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

  // Indicador "IA está digitando…" — Concierge emite typing:true ao
  // começar processamento e typing:false no final. Reduz percepção de
  // latência (user vê feedback imediato em vez de re-mandar msg).
  const [typing, setTyping] = useState<{ active: boolean; personaName?: string }>({ active: false });
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;

      const onTyping = (payload: { conversation_id: string; typing: boolean; persona_name?: string }) => {
        if (payload.conversation_id !== conversationId) return;
        if (safetyTimer) clearTimeout(safetyTimer);
        setTyping({
          active: payload.typing,
          ...(payload.persona_name ? { personaName: payload.persona_name } : {}),
        });
        // Safety: força typing=false após 30s caso evento de fim seja perdido
        if (payload.typing) {
          safetyTimer = setTimeout(() => {
            setTyping({ active: false });
          }, 30_000);
        }
      };
      socket.on('concierge:typing', onTyping);
      cleanup = () => socket.off('concierge:typing', onTyping);
    })();

    return () => {
      cancelled = true;
      if (safetyTimer) clearTimeout(safetyTimer);
      cleanup?.();
      setTyping({ active: false });
    };
  }, [conversationId]);

  // Debounced refresh dos gaps quando o número de mensagens muda — 30s
  // pra evitar chamada de IA a cada mensagem (cache backend é 5min, mas o
  // refreshKey força invalidação do componente quando há contexto novo).
  const messageCount = chat.messages.length;
  useEffect(() => {
    if (!conversationId || messageCount === 0) return;
    const t = setTimeout(() => {
      setGapsRefreshKey((k) => k + 1);
    }, 30_000);
    return () => clearTimeout(t);
  }, [conversationId, messageCount]);

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
        conversationId={conversationId}
      />

      {/* Indicador "IA está digitando…" (Concierge processando) */}
      {typing.active && (
        <div className="flex items-center gap-2 border-t border-border bg-cyan-500/5 px-4 py-2 text-xs text-cyan-700 dark:text-cyan-300 animate-in fade-in">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium">{typing.personaName ?? 'IA'} está digitando</span>
          <span className="inline-flex gap-0.5">
            <span className="h-1 w-1 animate-bounce rounded-full bg-cyan-500 [animation-delay:0ms]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-cyan-500 [animation-delay:150ms]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-cyan-500 [animation-delay:300ms]" />
          </span>
        </div>
      )}

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

      {/* Atenção da IA — gaps detectados via Haiku. Cache 5min no backend +
          refresh debounced 30s no frontend ao chegar mensagem nova. */}
      <AIInsightsCard
        conversationId={conversationId}
        refreshKey={gapsRefreshKey}
        compact={compact}
        onAskNow={(suggestion) => setPrefill(suggestion)}
        onScrollToMessage={(idx) => {
          // Tenta scroll até a mensagem N — MessageList renderiza em ordem
          // cronológica (oldest → newest), então usa nth-child do <ul>.
          const list = document.querySelector('[data-chat-message-list] ul');
          const target = list?.children[idx] as HTMLElement | undefined;
          target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target?.classList.add('ring-2', 'ring-yellow-500/50');
          setTimeout(() => {
            target?.classList.remove('ring-2', 'ring-yellow-500/50');
          }, 2000);
        }}
      />

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
