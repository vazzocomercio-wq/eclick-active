'use client';

import { useCallback, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { Contact, ConversationDetail } from '@eclick-active/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useInbox } from '@/hooks/use-inbox';
import { InboxList } from '@/components/inbox/inbox-list';
import { ChatPanel } from '@/components/chat/chat-panel';
import { ContactPanel } from '@/components/inbox/contact-panel';
import { ContactDetailSheet } from '@/components/contacts/contact-detail-sheet';
import { contactsApi } from '@/lib/api/contacts';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export default function ConversasPage() {
  const inbox = useInbox();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeDetail, setActiveDetail] = useState<ConversationDetail | null>(null);

  // Contact Detail Sheet — aberto via "Ver perfil completo" no painel lateral
  const [contactSheet, setContactSheet] = useState<Contact | null>(null);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleConversationLoad = useCallback((c: ConversationDetail) => {
    setActiveDetail(c);
  }, []);

  // Abre o ContactDetailSheet completo. Faz fetch primeiro pra garantir
  // shape Contact completo (o ContactPanel só tem subset via join).
  const handleOpenFullProfile = useCallback(async (contactId: string) => {
    try {
      const contact = await contactsApi.get(contactId);
      setContactSheet(contact);
      setContactSheetOpen(true);
    } catch (err) {
      toast.error('Falha ao abrir perfil do contato', {
        description:
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro desconhecido',
      });
    }
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
            <ChatPanel
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
            <ContactPanel
              conversation={activeDetail}
              loading={false}
              onOpenFullProfile={handleOpenFullProfile}
            />
          </aside>
        </div>

        {/* Contact Detail Sheet completo (overlay) */}
        <ContactDetailSheet
          contact={contactSheet}
          open={contactSheetOpen}
          onOpenChange={setContactSheetOpen}
        />
      </div>
    </TooltipProvider>
  );
}
