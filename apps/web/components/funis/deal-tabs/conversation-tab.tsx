'use client';

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Bot,
  Link2,
  Loader2,
  MessageCircle,
  MessageSquare,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ChannelType, Deal, InboxItem } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChatPanel } from '@/components/chat/chat-panel';
import { CopilotPanel } from '@/components/copilot/copilot-panel';
import { StartConversationDialog } from '@/components/inbox/start-conversation-dialog';
import { conversationsApi } from '@/lib/api/conversations';
import { dealsApi } from '@/lib/api/deals';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface DealConversationTabHandle {
  /** Permite que o pai injete uma sugestão de mensagem no input do chat. */
  prefillChatInput: (text: string) => void;
}

interface DealConversationTabProps {
  deal: Pick<Deal, 'id' | 'conversation_id' | 'contact_id' | 'title'> & {
    contact?: { name: string | null } | null;
  };
  /** Disparado após mutação que muda o deal (ex: vincular conversa). */
  onChanged: () => void | Promise<void>;
}

/**
 * Aba "Conversa" do Deal Detail Sheet — 3 estados possíveis:
 *
 *   1. Deal tem conversation_id    → renderiza ChatPanel compact
 *   2. Deal sem conversation_id mas com contact_id → busca conversas
 *      do contato; mostra a mais recente + botão "Vincular conversa"
 *   3. Sem conversa nem contato     → empty state "Iniciar conversa"
 *
 * Sobre o ChatPanel: consome o `prefill` interno via ref-bridge — quando
 * o `MainTab` (via `AIGapsCard`) emite `onAskClient(text)`, o pai chama
 * `prefillChatInput(text)` neste componente, que dispara um state que o
 * ChatPanel ainda não suporta diretamente. Pra v1, esse componente espelha
 * o pedido em estado local que troca a conversa pra ativa e exibe um
 * banner com a sugestão pra o vendedor copiar/colar — refinement futuro
 * adiciona prop `prefill` ao ChatPanel pra injeção 1-shot direta.
 *
 * Copiloto flutuante: ícone 🤖 no canto inferior direito, click expande
 * um popover absolute com `<CopilotPanel contextType="deal" compact>`.
 */
export const DealConversationTab = forwardRef<
  DealConversationTabHandle,
  DealConversationTabProps
>(function DealConversationTab({ deal, onChanged }, ref) {
  const t = useTranslations('funis.deal.conversationTab');
  const [pendingPrefill, setPendingPrefill] = useState<string | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      prefillChatInput(text: string) {
        setPendingPrefill(text);
      },
    }),
    [],
  );

  // Limpa banner de prefill quando trocar conversa ou usuário fechar
  function dismissPrefill() {
    setPendingPrefill(null);
  }

  async function handleCopyPrefill() {
    if (!pendingPrefill) return;
    try {
      await navigator.clipboard.writeText(pendingPrefill);
      toast.success(t('copied'));
    } catch {
      toast.info(t('copiedFallback'), { description: pendingPrefill.slice(0, 80) });
    }
  }

  return (
    <div className="relative flex h-full flex-col">
      {pendingPrefill && (
        <div className="flex items-start gap-2 border-b border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              {t('prefillKicker')}
            </span>
            <p className="line-clamp-2 leading-snug">{pendingPrefill}</p>
          </div>
          <Button
            size="sm"
            onClick={handleCopyPrefill}
            className="h-6 px-2 text-[11px]"
          >
            {t('copy')}
          </Button>
          <button
            type="button"
            onClick={dismissPrefill}
            aria-label={t('dismissPrefill')}
            className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden p-3">
        <ConversationContent deal={deal} onChanged={onChanged} />
      </div>

      {/* Botão flutuante 🤖 Copiloto */}
      <button
        type="button"
        onClick={() => setCopilotOpen((v) => !v)}
        aria-label={t('copilotOpen')}
        className={cn(
          'absolute bottom-4 right-4 z-20 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-all',
          copilotOpen
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary text-primary-foreground hover:scale-105',
        )}
      >
        {copilotOpen ? <X className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </button>

      {/* Popover do Copiloto (absoluto, sobre o chat) */}
      {copilotOpen && (
        <div
          className="absolute bottom-16 right-4 z-20 flex h-[420px] w-[300px] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
          role="dialog"
          aria-label={t('ariaCopilot')}
        >
          <CopilotPanel
            contextType="deal"
            contextId={deal.id}
            contextLabel={
              deal.contact?.name ? `${deal.title} · ${deal.contact.name}` : deal.title
            }
            compact
            showHeader={false}
            className="h-full"
          />
        </div>
      )}
    </div>
  );
});

// ──────────────────────────────────────────────────────────
// ConversationContent — escolhe entre os 3 estados
// ──────────────────────────────────────────────────────────

function ConversationContent({
  deal,
  onChanged,
}: {
  deal: DealConversationTabProps['deal'];
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations('funis.deal.conversationTab');
  const [contactConversations, setContactConversations] = useState<InboxItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estado 1: deal já tem conversa → chat direto
  // Estado 2/3: tenta encontrar conversas do contato
  const needsContactLookup = !deal.conversation_id && !!deal.contact_id;

  useEffect(() => {
    if (!needsContactLookup) {
      setContactConversations(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    conversationsApi
      .getByContactId(deal.contact_id!, ctrl.signal)
      .then((r) => setContactConversations(r.data))
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : t('fetchError'),
        );
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [needsContactLookup, deal.contact_id]);

  // ── Estado 1: deal tem conversation_id ──
  if (deal.conversation_id) {
    return (
      <ChatPanel
        conversationId={deal.conversation_id}
        compact
        showHeader={false}
        className="h-full"
      />
    );
  }

  // ── Estado 2 (loading) ──
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {error}
      </div>
    );
  }

  // ── Estado 2: deal sem conversation_id mas com conversas no contato ──
  if (deal.contact_id && contactConversations && contactConversations.length > 0) {
    return (
      <ContactConversationsList
        dealId={deal.id}
        conversations={contactConversations}
        onLinked={onChanged}
      />
    );
  }

  // ── Estado 3: empty state ──
  return (
    <EmptyConversationState
      deal={deal}
      onCreated={async (conversationId) => {
        try {
          await dealsApi.update(deal.id, { conversation_id: conversationId });
        } catch (err) {
          // Não bloqueia: a conversa foi criada com sucesso; só não vinculou.
          toast.error(t('createdNotLinked'), {
            description:
              err instanceof ApiError
                ? `${err.status}: ${err.message}`
                : err instanceof Error
                  ? err.message
                  : t('unknownError'),
          });
        }
        await onChanged();
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────
// ContactConversationsList — lista + vincular
// ──────────────────────────────────────────────────────────

function ContactConversationsList({
  dealId,
  conversations,
  onLinked,
}: {
  dealId: string;
  conversations: InboxItem[];
  onLinked: () => void | Promise<void>;
}) {
  const t = useTranslations('funis.deal.conversationTab');
  const channelLabel = useChannelLabel();
  const [selected, setSelected] = useState<string | null>(conversations[0]?.id ?? null);
  const [linking, setLinking] = useState(false);

  async function handleLink() {
    if (!selected) return;
    setLinking(true);
    try {
      await dealsApi.update(dealId, { conversation_id: selected });
      toast.success(t('linkedSuccess'));
      await onLinked();
    } catch (err) {
      toast.error(t('linkFailed'), {
        description:
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : t('unknownError'),
      });
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {conversations.length === 1
          ? t('linkHintOne', { count: conversations.length })
          : t('linkHintMany', { count: conversations.length })}
      </p>

      <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
        {conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelected(c.id)}
            className={cn(
              'flex flex-col gap-0.5 rounded-md border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/60',
              selected === c.id && 'border-primary/50 bg-primary/5',
            )}
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium capitalize">
                {channelLabel(c.channel_type as ChannelType)} · {c.status}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {c.last_message_at
                  ? new Date(c.last_message_at).toLocaleDateString('pt-BR')
                  : '—'}
              </span>
            </div>
            <span className="line-clamp-1 text-[11px] text-muted-foreground">
              {c.ai_summary ?? t('noPreview')}
            </span>
          </button>
        ))}
      </div>

      <Button onClick={handleLink} disabled={!selected || linking} className="self-end">
        {linking ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Link2 className="mr-1.5 h-3.5 w-3.5" />
        )}
        {t('linkConversation')}
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// EmptyConversationState
// ──────────────────────────────────────────────────────────

function EmptyConversationState({
  deal,
  onCreated,
}: {
  deal: DealConversationTabProps['deal'];
  onCreated: (conversationId: string) => void | Promise<void>;
}) {
  const t = useTranslations('funis.deal.conversationTab');
  const [startOpen, setStartOpen] = useState(false);

  function handleClick() {
    if (!deal.contact_id) {
      toast.error(t('noContactTitle'), {
        description: t('noContactDescription'),
      });
      return;
    }
    setStartOpen(true);
  }

  return (
    <>
      <Card className="flex h-full items-center justify-center border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <MessageCircle className="h-6 w-6" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">{t('emptyTitle')}</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {deal.contact_id ? t('emptyHasContact') : t('emptyNoContact')}
            </p>
          </div>
          <Button onClick={handleClick} disabled={!deal.contact_id} size="sm">
            <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
            {t('startConversation')}
          </Button>
        </CardContent>
      </Card>
      {deal.contact_id && (
        <StartConversationDialog
          open={startOpen}
          onOpenChange={setStartOpen}
          initialContactId={deal.contact_id}
          onStarted={(resp) => {
            void onCreated(resp.conversation.id);
          }}
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function useChannelLabel(): (channel: ChannelType) => string {
  const t = useTranslations('funis.deal.conversationTab.channels');
  return (channel: ChannelType) => {
    try {
      return t(channel);
    } catch {
      return channel;
    }
  };
}
