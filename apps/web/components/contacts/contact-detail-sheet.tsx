'use client';

import { useEffect, useState } from 'react';
import { History, MessageSquare, Sparkles, Target, User } from 'lucide-react';
import { toast } from 'sonner';
import type { Contact } from '@eclick-active/shared';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ContactHeader } from './contact-detail-tabs/contact-header';
import { ContactMainTab } from './contact-detail-tabs/main-tab';
import { ContactConversationsTab } from './contact-detail-tabs/conversations-tab';
import { ContactDealsTab } from './contact-detail-tabs/deals-tab';
import { ContactAITab } from './contact-detail-tabs/ai-tab';
import { ContactHistoryTab } from './contact-detail-tabs/history-tab';
import { contactsApi } from '@/lib/api/contacts';
import { ApiError } from '@/lib/api/client';

interface ContactDetailSheetProps {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Disparado após mutação bem-sucedida (recarrega lista pai). */
  onChanged?: () => void;
  /** Disparado quando o usuário clica num deal vinculado. */
  onOpenDeal?: (dealId: string) => void;
}

type TabKey = 'main' | 'chat' | 'deals' | 'ai' | 'history';

/**
 * Hub central do Contato. Sheet lateral 520px com:
 *   - Header fixo: avatar grande, nome inline-edit, badges + score, menu ⋯
 *   - 5 abas:
 *     1. Principal — info + custom fields + AI gaps
 *     2. Conversas — lista (auto-abre se única) ou ChatPanel
 *     3. Negócios — cards com stage colorido + score; click abre Deal Sheet
 *     4. IA — resumo, temperatura, score, objeções
 *     5. Histórico — timeline append-only de active.contact_timeline
 *
 * Recarrega o contato sempre que muda — mas o pai (página /contatos)
 * mantém a lista atualizada via `onChanged`.
 */
export function ContactDetailSheet({
  contact: initialContact,
  open,
  onOpenChange,
  onChanged,
  onOpenDeal,
}: ContactDetailSheetProps) {
  // Mantém uma cópia local do contato pra refletir edits inline imediatamente
  // sem esperar que o pai re-faça a query. Sincroniza com o prop quando muda.
  const [contact, setContact] = useState<Contact | null>(initialContact);
  const [tab, setTab] = useState<TabKey>('main');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setContact(initialContact);
  }, [initialContact]);

  // Reset aba ao abrir
  useEffect(() => {
    if (open) setTab('main');
  }, [open, initialContact?.id]);

  async function handleChanged() {
    if (!contact) return;
    try {
      const fresh = await contactsApi.get(contact.id);
      setContact(fresh);
    } catch {
      // Ignora — o pai recarrega via onChanged() e o próximo render sincroniza
    }
    onChanged?.();
  }

  async function handleDelete() {
    if (!contact) return;
    if (!window.confirm('Excluir este contato? A ação não pode ser desfeita.')) {
      return;
    }
    setDeleting(true);
    try {
      await contactsApi.remove(contact.id);
      toast.success('Contato excluído');
      onOpenChange(false);
      onChanged?.();
    } catch (err) {
      toast.error('Falha ao excluir', {
        description:
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro desconhecido',
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full max-w-[520px] flex-col gap-0 p-0 sm:max-w-[520px]"
      >
        <SheetTitle className="sr-only">
          {contact?.name ?? 'Detalhes do contato'}
        </SheetTitle>

        {!contact ? (
          <SkeletonView />
        ) : (
          <>
            <ContactHeader
              contact={contact}
              onChanged={handleChanged}
              onDelete={handleDelete}
              deleting={deleting}
            />

            <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="flex-1">
              <TabsList className="px-2">
                <TabsTrigger value="main">
                  <User className="h-3.5 w-3.5" />
                  Principal
                </TabsTrigger>
                <TabsTrigger value="chat">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Conversas
                </TabsTrigger>
                <TabsTrigger value="deals">
                  <Target className="h-3.5 w-3.5" />
                  Negócios
                </TabsTrigger>
                <TabsTrigger value="ai">
                  <Sparkles className="h-3.5 w-3.5" />
                  IA
                </TabsTrigger>
                <TabsTrigger value="history">
                  <History className="h-3.5 w-3.5" />
                  Histórico
                </TabsTrigger>
              </TabsList>

              <TabsContent value="main" className="overflow-y-auto">
                <ContactMainTab contact={contact} onChanged={handleChanged} />
              </TabsContent>

              <TabsContent value="chat" className="overflow-hidden">
                <ContactConversationsTab contactId={contact.id} />
              </TabsContent>

              <TabsContent value="deals" className="overflow-y-auto">
                <ContactDealsTab contactId={contact.id} onOpenDeal={onOpenDeal} />
              </TabsContent>

              <TabsContent value="ai" className="overflow-y-auto">
                <ContactAITab contact={contact} />
              </TabsContent>

              <TabsContent value="history" className="overflow-y-auto">
                <ContactHistoryTab contactId={contact.id} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SkeletonView() {
  return (
    <div className="flex flex-col gap-3 p-5">
      <Skeleton className="h-14 w-14 rounded-full" />
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
