'use client';

import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import type { Message } from '@eclick-active/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageBubble } from './message-bubble';

interface MessageListProps {
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export function MessageList({
  messages,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  // Auto-scroll pra fundo quando muda conversa OU chega mensagem nova
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    if (lastMessageIdRef.current === last.id) return;
    lastMessageIdRef.current = last.id;

    const c = containerRef.current;
    if (c) {
      // Pequeno delay pra DOM settle. requestAnimationFrame seria mais elegante.
      requestAnimationFrame(() => {
        c.scrollTop = c.scrollHeight;
      });
    }
  }, [messages]);

  // Mantém última mensagem visível quando o container encolhe (banners
  // "Resumo da IA" / "Atenção da IA" abrindo após a render inicial).
  // Só rescrola se o user já estava no fim — evita atrapalhar leitura
  // de mensagens antigas quando o banner expande durante scroll up.
  useEffect(() => {
    const c = containerRef.current;
    if (c === null) return;

    let userAtBottom = true;
    const updateAtBottom = () => {
      userAtBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 80;
    };
    c.addEventListener('scroll', updateAtBottom, { passive: true });

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (userAtBottom) {
        c.scrollTop = c.scrollHeight;
      }
    });
    ro.observe(c);

    return () => {
      ro.disconnect();
      c.removeEventListener('scroll', updateAtBottom);
    };
  }, []);

  // IntersectionObserver no topo: dispara loadMore quando sentinel entra na viewport
  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore) {
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
        Nenhuma mensagem ainda. Envie a primeira pra começar a conversa.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
      <div ref={sentinelRef} />
      {hasMore && (
        <div className="flex justify-center py-2">
          {loadingMore ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <span className="text-xs text-muted-foreground">Carregue rolando ↑</span>
          )}
        </div>
      )}
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
    </div>
  );
}
