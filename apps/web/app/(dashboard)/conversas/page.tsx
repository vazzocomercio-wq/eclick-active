'use client';

import { useCallback, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ConversationDetail } from '@eclick-active/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useInbox } from '@/hooks/use-inbox';
import { InboxList } from '@/components/inbox/inbox-list';
import { ChatView } from '@/components/inbox/chat-view';
import { ContactPanel } from '@/components/inbox/contact-panel';
import { cn } from '@/lib/utils';

export default function ConversasPage() {
  const inbox = useInbox();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeDetail, setActiveDetail] = useState<ConversationDetail | null>(null);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleConversationLoad = useCallback((c: ConversationDetail) => {
    setActiveDetail(c);
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col">
        {inbox.error && (
          <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              {inbox.error.status === 401
                ? 'Sessão expirada — faça login pra carregar conversas.'
                : `Erro ${inbox.error.status || 'rede'}: ${inbox.error.message}`}
            </span>
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {/* COLUNA 1 — Lista de conversas */}
          <aside
            className={cn(
              'w-80 shrink-0 border-r border-border bg-background',
              // Em mobile, esconde a lista quando uma conversa está aberta
              selectedId ? 'hidden md:flex md:flex-col' : 'flex flex-col',
            )}
          >
            <InboxList
              items={inbox.items}
              loading={inbox.loading}
              selectedId={selectedId}
              onSelect={handleSelect}
              filter={inbox.filter}
              onFilterChange={inbox.setFilter}
              search={inbox.search}
              onSearchChange={inbox.setSearch}
            />
          </aside>

          {/* COLUNA 2 — Chat */}
          <main className="flex flex-1 flex-col min-w-0">
            <ChatView
              conversationId={selectedId}
              panelOpen={panelOpen}
              onTogglePanel={() => setPanelOpen((v) => !v)}
              onConversationLoad={handleConversationLoad}
            />
          </main>

          {/* COLUNA 3 — Painel do contato */}
          <aside
            className={cn(
              'w-72 shrink-0 border-l border-border bg-background transition-[width]',
              !panelOpen && 'w-0 overflow-hidden',
              // Esconde em telas < lg sempre (toggle só em lg+)
              'hidden lg:block',
            )}
            aria-hidden={!panelOpen}
          >
            <ContactPanel conversation={activeDetail} loading={false} />
          </aside>
        </div>
      </div>
    </TooltipProvider>
  );
}
