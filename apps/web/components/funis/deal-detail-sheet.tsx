'use client';

import { useEffect, useRef, useState } from 'react';
import { History, MessageSquare, Sparkles, Trash2, User } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { LostReasonDialog } from './lost-reason-dialog';
import { DealHeader } from './deal-tabs/deal-header';
import { DealMainTab } from './deal-tabs/main-tab';
import {
  DealConversationTab,
  type DealConversationTabHandle,
} from './deal-tabs/conversation-tab';
import { DealInsightsTab } from './deal-tabs/insights-tab';
import { DealHistoryTab } from './deal-tabs/history-tab';
import { useDealDetail } from '@/hooks/use-deal-detail';
import { dealsApi } from '@/lib/api/deals';
import { ApiError } from '@/lib/api/client';
import type { PipelineWithStages } from '@/lib/api/pipelines';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/ui/confirm-provider';

interface DealDetailSheetProps {
  dealId: string | null;
  pipeline: PipelineWithStages | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

type TabKey = 'main' | 'chat' | 'insights' | 'history';

/**
 * Hub central do Deal. Sheet lateral 520px à direita com:
 *   - Header fixo: número, título inline-edit, valor inline-edit, stage
 *     dropdown colorido, badges (score/risk/temp), ações Ganho/Perdido/⋯
 *   - 4 abas:
 *     1. Principal — contato, dados, custom fields, AI Gaps
 *     2. Conversa — ChatPanel compact + Copiloto flutuante
 *     3. IA Insights — score breakdown, risk, próxima ação, recalcular
 *     4. Histórico — timeline + nota
 *
 * O AIGapsCard (em Principal) emite "Pedir ao cliente" → o pai usa o
 * ref do ConversationTab pra preencher o input do chat e auto-troca a
 * aba ativa pra "Conversa".
 */
export function DealDetailSheet({
  dealId,
  pipeline,
  open,
  onOpenChange,
  onChanged,
}: DealDetailSheetProps) {
  const { detail, activities, loading, reload } = useDealDetail(dealId);
  const [tab, setTab] = useState<TabKey>('main');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirm = useConfirm();
  const [showLostDialog, setShowLostDialog] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const conversationRef = useRef<DealConversationTabHandle>(null);

  // Reset aba ao trocar de deal
  useEffect(() => {
    if (open) setTab('main');
  }, [open, dealId]);

  // Carrega user atual pra "Criar tarefa" do InsightsTab
  useEffect(() => {
    if (!open) return;
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) setCurrentUserId(data.user.id);
    });
  }, [open]);

  if (!dealId) return null;

  async function handleChanged() {
    await reload();
    onChanged();
  }

  async function handleConfirmLost(reason: string) {
    if (!detail) return;
    const lostStage = pipeline?.stages.find((s) => s.is_lost);
    if (!lostStage) {
      toast.error('Pipeline sem stage de "perdido" configurado');
      return;
    }
    setSaving(true);
    try {
      await dealsApi.move(detail.id, { stage_id: lostStage.id, lost_reason: reason });
      setShowLostDialog(false);
      await handleChanged();
      toast.success('Deal marcado como perdido');
    } catch (err) {
      toast.error('Falha ao marcar perdido', {
        description:
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro desconhecido',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleMoveToWon() {
    if (!detail) return;
    const wonStage = pipeline?.stages.find((s) => s.is_won);
    if (!wonStage) {
      toast.error('Pipeline sem stage de "ganho" configurado');
      return;
    }
    setSaving(true);
    try {
      await dealsApi.move(detail.id, { stage_id: wonStage.id });
      await handleChanged();
      toast.success('Deal marcado como ganho!');
    } catch (err) {
      toast.error('Falha ao marcar ganho', {
        description:
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro desconhecido',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!detail) return;
    const ok = await confirm({
      title: 'Excluir este deal?',
      description: 'A ação não pode ser desfeita.',
      variant: 'destructive',
      confirmLabel: 'Excluir',
      icon: Trash2,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await dealsApi.remove(detail.id);
      toast.success('Deal excluído');
      onOpenChange(false);
      onChanged();
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

  /**
   * Disparado pelo AIGapsCard (na aba Principal) quando o vendedor clica
   * "Pedir ao cliente". Troca pra aba Conversa e injeta a sugestão no
   * banner de prefill do ChatPanel.
   */
  function handleAskClient(text: string) {
    setTab('chat');
    // Aguarda o painel montar antes de injetar
    requestAnimationFrame(() => {
      conversationRef.current?.prefillChatInput(text);
    });
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full max-w-[520px] flex-col gap-0 p-0 sm:max-w-[520px]"
        >
          {/* SheetTitle escondido (acessibilidade) — o header customizado
              tem o título visualmente. */}
          <SheetTitle className="sr-only">
            {detail?.title ?? 'Detalhes do negócio'}
          </SheetTitle>

          {loading || !detail ? (
            <SkeletonView />
          ) : (
            <>
              <DealHeader
                deal={detail}
                pipeline={pipeline}
                onChanged={handleChanged}
                onMoveToLost={() => setShowLostDialog(true)}
                onMoveToWon={handleMoveToWon}
                onDelete={handleDelete}
                saving={saving}
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
                    Conversa
                  </TabsTrigger>
                  <TabsTrigger value="insights">
                    <Sparkles className="h-3.5 w-3.5" />
                    IA Insights
                  </TabsTrigger>
                  <TabsTrigger value="history">
                    <History className="h-3.5 w-3.5" />
                    Histórico
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="main" className="overflow-y-auto">
                  <DealMainTab
                    deal={detail}
                    conversationId={detail.conversation_id ?? null}
                    onAskClient={handleAskClient}
                    onChanged={handleChanged}
                  />
                </TabsContent>

                <TabsContent value="chat" className="overflow-hidden">
                  <DealConversationTab
                    ref={conversationRef}
                    deal={detail}
                    onChanged={handleChanged}
                  />
                </TabsContent>

                <TabsContent value="insights" className="overflow-y-auto">
                  <div className="p-4">
                    <DealInsightsTab
                      detail={detail}
                      onChanged={handleChanged}
                      currentUserId={currentUserId}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="history" className="overflow-y-auto">
                  <div className="p-4">
                    <DealHistoryTab
                      dealId={detail.id}
                      activities={activities}
                      loading={loading}
                      pipeline={pipeline}
                      onActivityAdded={handleChanged}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      <LostReasonDialog
        open={showLostDialog}
        onConfirm={handleConfirmLost}
        onCancel={() => setShowLostDialog(false)}
      />
    </>
  );
}

function SkeletonView() {
  return (
    <div className="flex flex-col gap-3 p-5">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-7 w-1/2" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
