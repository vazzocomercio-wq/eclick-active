'use client';

import { useEffect, useRef } from 'react';
import { Inbox, Loader2, MessageSquarePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { InboxItem } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { InboxFilters } from './inbox-filters';
import { ConversationItem } from './conversation-item';
import type { InboxFilter } from '@/hooks/use-inbox';

interface InboxListProps {
  items: InboxItem[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: InboxFilter;
  onFilterChange: (f: InboxFilter) => void;
  search: string;
  onSearchChange: (q: string) => void;
  /** Click no botão "Nova conversa" no header — abre o dialog na page. */
  onStartNew: () => void;
}

export function InboxList({
  items,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  onStartNew,
}: InboxListProps) {
  const t = useTranslations('inbox.list');
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll: sentinel no fim da lista + IntersectionObserver rooteado
  // na viewport do ScrollArea (mesma técnica do message-list).
  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const root =
      (scrollRootRef.current?.querySelector(
        '[data-radix-scroll-area-viewport]',
      ) as HTMLElement | null) ?? null;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore) {
          onLoadMore();
        }
      },
      { root, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore, items.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{t('title')}</h2>
          <p className="text-xs text-muted-foreground">
            {loading ? t('loading') : t('count', { count: items.length })}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={onStartNew}
          className="h-8 shrink-0 gap-1.5"
          title={t('newButtonTitle')}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          <span className="text-xs">{t('newButton')}</span>
        </Button>
      </div>

      <InboxFilters
        filter={filter}
        onFilterChange={onFilterChange}
        search={search}
        onSearchChange={onSearchChange}
      />

      <ScrollArea ref={scrollRootRef} className="flex-1">
        {loading && items.length === 0 ? (
          <SkeletonList />
        ) : items.length === 0 ? (
          <EmptyInbox />
        ) : (
          <>
            {items.map((item) => (
              <ConversationItem
                key={item.id}
                item={item}
                active={item.id === selectedId}
                onSelect={() => onSelect(item.id)}
              />
            ))}
            <div ref={sentinelRef} />
            {loadingMore && (
              <div className="flex justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </>
        )}
      </ScrollArea>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-1 p-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 flex flex-col gap-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyInbox() {
  const t = useTranslations('inbox.list');
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 px-4 text-center">
      <Inbox className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">{t('emptyTitle')}</p>
      <p className="text-xs text-muted-foreground">
        {t('emptySubtitle')}
      </p>
    </div>
  );
}
