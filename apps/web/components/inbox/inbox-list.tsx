'use client';

import { Inbox } from 'lucide-react';
import type { InboxItem } from '@eclick-active/shared';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { InboxFilters } from './inbox-filters';
import { ConversationItem } from './conversation-item';
import type { InboxFilter } from '@/hooks/use-inbox';

interface InboxListProps {
  items: InboxItem[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: InboxFilter;
  onFilterChange: (f: InboxFilter) => void;
  search: string;
  onSearchChange: (q: string) => void;
}

export function InboxList({
  items,
  loading,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  search,
  onSearchChange,
}: InboxListProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Conversas</h2>
        <p className="text-xs text-muted-foreground">
          {loading ? 'Carregando...' : `${items.length} conversas`}
        </p>
      </div>

      <InboxFilters
        filter={filter}
        onFilterChange={onFilterChange}
        search={search}
        onSearchChange={onSearchChange}
      />

      <ScrollArea className="flex-1">
        {loading && items.length === 0 ? (
          <SkeletonList />
        ) : items.length === 0 ? (
          <EmptyInbox />
        ) : (
          items.map((item) => (
            <ConversationItem
              key={item.id}
              item={item}
              active={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
            />
          ))
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
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 px-4 text-center">
      <Inbox className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">Nenhuma conversa ainda</p>
      <p className="text-xs text-muted-foreground">
        Quando uma mensagem chegar via canal, ela aparece aqui.
      </p>
    </div>
  );
}
