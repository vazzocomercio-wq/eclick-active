'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Message } from '@eclick-active/shared';
import { useConversationAttachments } from '@/hooks/use-conversation-attachments';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageBubble } from './message-bubble';

interface MessageListProps {
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** ID da conversa pra buscar attachments (mídia + summary IA). */
  conversationId: string | null;
  /** Reenvia uma mensagem outbound que falhou. */
  onRetry?: (messageId: string) => void;
}

export function MessageList({
  messages,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  conversationId,
  onRetry,
}: MessageListProps) {
  const t = useTranslations('inbox.messageList');
  // Detecta msgs inbound de mídia que ainda podem não ter attachment
  // associado (worker leva ~1-3s pra processar). useConversationAttachments
  // faz auto-poll enquanto a lista contiver IDs sem attachment matching.
  const pendingMediaIds = messages
    .filter(
      (m) =>
        m.direction === 'inbound' &&
        m.content_type !== 'text' &&
        m.content_type !== 'system',
    )
    .map((m) => m.id);
  // refreshKey muda quando qualquer msg nova chega → força refetch inicial
  const attachmentsByMessage = useConversationAttachments(
    conversationId,
    `${messages.length}-${messages[messages.length - 1]?.id ?? ''}`,
    pendingMediaIds,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Estado de scroll compartilhado entre efeitos.
  const atBottomRef = useRef(true);
  // Ids anterior (primeiro/último) pra distinguir append (msg nova no fim),
  // prepend (página antiga no topo) e carga inicial (troca de conversa).
  const prevFirstIdRef = useRef<string | null>(null);
  const prevLastIdRef = useRef<string | null>(null);
  // Medida de scroll ANTES do prepend pra restaurar a viewport (não saltar).
  const prependAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const [showNewMessages, setShowNewMessages] = useState(false);

  function scrollToBottom() {
    const c = containerRef.current;
    if (!c) return;
    requestAnimationFrame(() => {
      c.scrollTop = c.scrollHeight;
    });
  }

  // Auto-scroll inteligente ao mudar `messages`:
  //  - carga inicial (troca de conversa) → cola no fim
  //  - prepend (loadMore) → restaura âncora pra viewport não saltar
  //  - append (msg nova) → só cola no fim se o user já estava no fim OU se
  //    a msg é outbound (própria). Caso contrário, mostra o chip "novas ↓".
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const first = messages[0];
    const last = messages[messages.length - 1];
    if (!last) {
      prevFirstIdRef.current = null;
      prevLastIdRef.current = null;
      return;
    }

    const prevFirst = prevFirstIdRef.current;
    const prevLast = prevLastIdRef.current;
    const isInitial = prevLast === null;
    const isPrepend =
      !isInitial && prevLast === last.id && prevFirst !== (first?.id ?? null);
    const isAppend = !isInitial && prevLast !== last.id;

    if (isInitial) {
      scrollToBottom();
    } else if (isPrepend) {
      const anchor = prependAnchorRef.current;
      if (anchor) {
        // Mantém o conteúdo que o user estava lendo no mesmo lugar: soma a
        // altura recém-adicionada acima ao scrollTop anterior.
        const added = c.scrollHeight - anchor.height;
        c.scrollTop = anchor.top + added;
        prependAnchorRef.current = null;
      }
    } else if (isAppend) {
      if (atBottomRef.current || last.direction === 'outbound') {
        scrollToBottom();
      } else {
        setShowNewMessages(true);
      }
    }

    prevFirstIdRef.current = first?.id ?? null;
    prevLastIdRef.current = last.id;
  }, [messages]);

  // Mantém última mensagem visível quando o container encolhe (banners
  // "Resumo da IA" / "Atenção da IA" abrindo após a render inicial).
  // Só rescrola se o user já estava no fim — evita atrapalhar leitura
  // de mensagens antigas quando o banner expande durante scroll up.
  useEffect(() => {
    const c = containerRef.current;
    if (c === null) return;

    const updateAtBottom = () => {
      const atBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 80;
      atBottomRef.current = atBottom;
      if (atBottom) setShowNewMessages(false);
    };
    updateAtBottom();
    c.addEventListener('scroll', updateAtBottom, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (atBottomRef.current) {
          c.scrollTop = c.scrollHeight;
        }
      });
      ro.observe(c);
    }

    return () => {
      ro?.disconnect();
      c.removeEventListener('scroll', updateAtBottom);
    };
  }, []);

  // IntersectionObserver no topo: dispara loadMore quando sentinel entra na viewport
  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    const c = containerRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore) {
          // Captura a medida ANTES do prepend pra restaurar a âncora depois.
          if (c) {
            prependAnchorRef.current = { height: c.scrollHeight, top: c.scrollTop };
          }
          onLoadMore();
        }
      },
      { root: containerRef.current, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Skeleton className="ml-auto h-10 w-1/3" />
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="ml-auto h-8 w-1/4" />
        <Skeleton className="h-14 w-2/3" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        {t('emptyState')}
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div ref={containerRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
        <div ref={sentinelRef} />
        {hasMore && (
          <div className="flex justify-center py-2">
            {loadingMore ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <span className="text-xs text-muted-foreground">{t('loadMoreHint')}</span>
            )}
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            attachments={attachmentsByMessage.get(m.id)}
            {...(onRetry ? { onRetry } : {})}
          />
        ))}
      </div>

      {showNewMessages && (
        <button
          type="button"
          onClick={() => {
            scrollToBottom();
            setShowNewMessages(false);
          }}
          className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition-transform hover:scale-105"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          {t('newMessages')}
        </button>
      )}
    </div>
  );
}
