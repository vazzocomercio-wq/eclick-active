'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, User } from 'lucide-react';
import { toast } from 'sonner';
import type { Contact, ConversationDetail } from '@eclick-active/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useInbox } from '@/hooks/use-inbox';
import { InboxList } from '@/components/inbox/inbox-list';
import { ChatPanel } from '@/components/chat/chat-panel';
import { ContactPanel } from '@/components/inbox/contact-panel';
import { CopilotPanel } from '@/components/copilot/copilot-panel';
import { ContactDetailSheet } from '@/components/contacts/contact-detail-sheet';
import { StartConversationDialog } from '@/components/inbox/start-conversation-dialog';
import { contactsApi } from '@/lib/api/contacts';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type SidePanel = 'contact' | 'copilot';

export default function ConversasPage() {
  const inbox = useInbox();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeDetail, setActiveDetail] = useState<ConversationDetail | null>(null);
  const [sidePanel, setSidePanel] = useState<SidePanel>('contact');

  // Contact Detail Sheet — aberto via "Ver perfil completo" no painel lateral
  const [contactSheet, setContactSheet] = useState<Contact | null>(null);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);

  // Dialog "Nova conversa" — botão no header da coluna 1
  const [startOpen, setStartOpen] = useState(false);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleConversationLoad = useCallback((c: ConversationDetail) => {
    setActiveDetail(c);
  }, []);

  // Quando a conversa selecionada deixa de existir na lista atual (foi
  // arquivada, resolvida, ou o filtro mudou), limpa a seleção pra UI não
  // ficar mostrando chat + sidebar de uma conversa que sumiu.
  useEffect(() => {
    if (!selectedId || inbox.loading) return;
    const stillInList = inbox.items.some((i) => i.id === selectedId);
    if (!stillInList) {
      setSelectedId(null);
      setActiveDetail(null);
    }
  }, [selectedId, inbox.items, inbox.loading]);

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
              onStartNew={() => setStartOpen(true)}
            />
          </aside>

          {/* COLUNA 2 — Chat */}
          <main className="flex flex-1 flex-col min-w-0">
            <ChatPanel
              conversationId={selectedId}
              panelOpen={panelOpen}
              onTogglePanel={() => setPanelOpen((v) => !v)}
              onConversationLoad={handleConversationLoad}
              onAction={(ev) => {
                // Optimistic update no inbox — não espera socket retornar
                // o conversation:updated. Remove/atualiza na hora pra UX
                // ficar instantânea, mesmo se realtime estiver off.
                if (!selectedId) return;
                if (ev === 'archive') {
                  if (inbox.filter !== 'archived') inbox.removeLocal(selectedId);
                  setSelectedId(null);
                } else if (ev === 'resolve') {
                  if (inbox.filter !== 'resolved') inbox.removeLocal(selectedId);
                  setSelectedId(null);
                } else if (ev === 'mark-read') {
                  inbox.patchLocal(selectedId, { unread_count: 0 });
                }
                // Outras ações (assign, create-task, summarize) não impactam
                // a posição na lista, o socket/polling cobre.
              }}
            />
          </main>

          {/* COLUNA 3 — Painel do contato OU Copiloto contextual */}
          <aside
            className={cn(
              'flex w-72 shrink-0 flex-col border-l border-border bg-background transition-[width]',
              !panelOpen && 'w-0 overflow-hidden',
              // Esconde em telas < lg sempre (toggle só em lg+)
              'hidden lg:flex',
            )}
            aria-hidden={!panelOpen}
          >
            {/* Toggle Contato / Copiloto */}
            <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card/50 p-1.5">
              <button
                type="button"
                onClick={() => setSidePanel('contact')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  sidePanel === 'contact'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <User className="h-3.5 w-3.5" />
                Contato
              </button>
              <button
                type="button"
                onClick={() => setSidePanel('copilot')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  sidePanel === 'copilot'
                    ? 'bg-cyan-500 text-white'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Bot className="h-3.5 w-3.5" />
                Copiloto
              </button>
            </div>

            <div className="flex-1 overflow-hidden">
              {sidePanel === 'contact' ? (
                <ContactPanel
                  conversation={activeDetail}
                  loading={false}
                  onOpenFullProfile={handleOpenFullProfile}
                />
              ) : (
                <CopilotPanel
                  contextType="conversation"
                  {...(selectedId ? { contextId: selectedId } : {})}
                  contextLabel={
                    activeDetail?.contact?.name ?? activeDetail?.contact?.phone ?? undefined
                  }
                  compact
                  showHeader={false}
                  className="h-full"
                />
              )}
            </div>
          </aside>
        </div>

        {/* Contact Detail Sheet completo (overlay) */}
        <ContactDetailSheet
          contact={contactSheet}
          open={contactSheetOpen}
          onOpenChange={setContactSheetOpen}
        />

        {/* Dialog "Nova conversa" — vendedor inicia outbound */}
        <StartConversationDialog
          open={startOpen}
          onOpenChange={setStartOpen}
          onStarted={(resp) => {
            // Recarrega o inbox e seleciona a conversa criada/reusada.
            void inbox.refetch();
            setSelectedId(resp.conversation.id);
          }}
        />
      </div>
    </TooltipProvider>
  );
}
