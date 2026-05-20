'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ListTodo,
  Loader2,
  Sparkles,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { ConversationDetail } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { NewTaskDialog } from '@/components/tarefas/new-task-dialog';
import { aiApi } from '@/lib/api/ai';
import { conversationsApi } from '@/lib/api/conversations';
import { ApiError } from '@/lib/api/client';
import { useTeamMembers } from '@/hooks/use-team-members';
import { InitialsAvatar } from '@/components/contacts/initials-avatar';
import { cn } from '@/lib/utils';

/** Ações que o ChatPanel pode propagar pro drawer pai reagir (ex: fechar drawer ao resolver). */
export type ChatActionEvent =
  | 'summarize'
  | 'resolve'
  | 'mark-read'
  | 'assign'
  | 'archive'
  | 'unarchive'
  | 'delete'
  | 'create-task';

interface ChatActionsProps {
  conversation: ConversationDetail | null;
  /** Disparado quando uma mutação altera a conversation row (resolve/assign). */
  onUpdated?: (patch: Partial<ConversationDetail>) => void;
  /** Disparado com o resumo gerado — ChatPanel mostra como mensagem especial. */
  onSummary?: (summary: string) => void;
  /** Genérico — drawer pai pode reagir (ex: refresh do deal após resolve). */
  onAction?: (event: ChatActionEvent) => void;
  /** Modo compacto: pills só com ícone + tooltip (drawer narrow). */
  compact?: boolean;
}

/**
 * Barra de ações rápidas no rodapé do chat (acima do input).
 *
 *  - ✨ Resumir — POST /ai/summarize/:conversationId, joga resumo no chat
 *  - ✓ Resolver — PATCH status='resolved'
 *  - 📖 Marcar lida — POST /conversations/:id/read
 *  - 👤 Atribuir — dropdown com membros da org, PATCH assigned_to
 *
 * Estilo: pills pequenas em row, fundo card, hover com borda primária,
 * ícones lucide 14px (`h-3.5 w-3.5`).
 */
export function ChatActions({
  conversation,
  onUpdated,
  onSummary,
  onAction,
  compact = false,
}: ChatActionsProps) {
  const t = useTranslations('chat.actions');
  const [summarizing, setSummarizing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [marking, setMarking] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);

  const conversationId = conversation?.id ?? null;
  const isResolved = conversation?.status === 'resolved' || conversation?.status === 'closed';
  const isArchived = conversation?.status === 'archived';
  const isUnread = (conversation?.unread_count ?? 0) > 0;
  const assignedTo = conversation?.assigned_to ?? null;
  const contactId = conversation?.contact_id ?? null;
  const contactName = conversation?.contact?.name ?? null;

  async function handleSummarize() {
    if (!conversationId) return;
    setSummarizing(true);
    try {
      const r = await aiApi.summarizeConversation(conversationId);
      if (!r.summary || !r.summary.trim()) {
        toast.info(t('summarizeNoMessagesTitle'), {
          description: t('summarizeNoMessagesDesc'),
        });
        return;
      }
      onSummary?.(r.summary);
      onUpdated?.({ ai_summary: r.summary });
      onAction?.('summarize');
      toast.success(t('summarizeSuccess'), {
        description: t('summarizeSuccessDesc'),
      });
    } catch (err) {
      toast.error(t('summarizeFailed'), { description: extractMessage(err, t) });
    } finally {
      setSummarizing(false);
    }
  }

  async function handleResolve() {
    if (!conversationId || isResolved) return;
    setResolving(true);
    try {
      const updated = await conversationsApi.update(conversationId, { status: 'resolved' });
      onUpdated?.(updated);
      onAction?.('resolve');
      toast.success(t('resolveSuccess'));
    } catch (err) {
      toast.error(t('resolveFailed'), { description: extractMessage(err, t) });
    } finally {
      setResolving(false);
    }
  }

  async function handleMarkRead() {
    if (!conversationId) return;
    setMarking(true);
    try {
      const updated = await conversationsApi.markAsRead(conversationId);
      onUpdated?.(updated);
      onAction?.('mark-read');
      toast.success(t('markReadSuccess'));
    } catch (err) {
      toast.error(t('markReadFailed'), { description: extractMessage(err, t) });
    } finally {
      setMarking(false);
    }
  }

  async function handleArchiveConfirmed() {
    if (!conversationId || isArchived) return;
    setArchiving(true);
    try {
      const updated = await conversationsApi.update(conversationId, { status: 'archived' });
      onUpdated?.(updated);
      onAction?.('archive');
      toast.success(t('archiveSuccess'));
    } catch (err) {
      toast.error(t('archiveFailed'), { description: extractMessage(err, t) });
      throw err; // ConfirmDialog mantém aberto se rejeitar
    } finally {
      setArchiving(false);
    }
  }

  /**
   * Desarquivar — volta status pra 'open'. Sem confirmação porque é
   * ação reversível e barata (oposto de arquivar).
   */
  async function handleUnarchive() {
    if (!conversationId || !isArchived) return;
    setArchiving(true);
    try {
      const updated = await conversationsApi.update(conversationId, { status: 'open' });
      onUpdated?.(updated);
      onAction?.('unarchive');
      toast.success(t('unarchiveSuccess'));
    } catch (err) {
      toast.error(t('unarchiveFailed'), { description: extractMessage(err, t) });
    } finally {
      setArchiving(false);
    }
  }

  /**
   * Excluir permanentemente — DELETE /conversations/:id. Cascade no banco
   * remove todas as mensagens. Irreversível, daí o confirm destructive.
   */
  async function handleDeleteConfirmed() {
    if (!conversationId) return;
    setDeleting(true);
    try {
      await conversationsApi.remove(conversationId);
      onAction?.('delete');
      toast.success(t('deleteSuccess'));
    } catch (err) {
      toast.error(t('deleteFailed'), { description: extractMessage(err, t) });
      throw err;
    } finally {
      setDeleting(false);
    }
  }

  async function handleAssign(userId: string | null) {
    if (!conversationId) return;
    setAssigning(true);
    try {
      const updated = await conversationsApi.update(conversationId, {
        assigned_to: userId,
      });
      onUpdated?.(updated);
      onAction?.('assign');
      toast.success(userId ? t('assignSuccess') : t('unassignSuccess'));
      setAssignOpen(false);
    } catch (err) {
      toast.error(t('assignFailed'), { description: extractMessage(err, t) });
    } finally {
      setAssigning(false);
    }
  }

  if (!conversationId) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 border-t border-border bg-card/50',
          compact ? 'px-2 py-1.5' : 'px-3 py-2',
        )}
      >
        <Pill
          onClick={handleSummarize}
          disabled={summarizing}
          loading={summarizing}
          compact={compact}
          tooltip={t('summarizeTooltip')}
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {!compact && t('summarize')}
        </Pill>

        <Pill
          onClick={handleResolve}
          disabled={resolving || isResolved}
          loading={resolving}
          compact={compact}
          tooltip={isResolved ? t('resolveTooltipResolved') : t('resolveTooltip')}
        >
          <CheckCircle2
            className={cn('h-3.5 w-3.5', isResolved ? 'text-emerald-500' : 'text-muted-foreground')}
          />
          {!compact && (isResolved ? t('resolved') : t('resolve'))}
        </Pill>

        <Pill
          onClick={handleMarkRead}
          disabled={marking || !isUnread}
          loading={marking}
          compact={compact}
          tooltip={isUnread ? t('markReadTooltip', { count: conversation?.unread_count ?? 0 }) : t('markReadAlready')}
        >
          <BookOpenCheck className="h-3.5 w-3.5 text-muted-foreground" />
          {!compact && (isUnread ? t('markReadShort', { count: conversation?.unread_count ?? 0 }) : t('markReadDone'))}
        </Pill>

        <Pill
          onClick={() => setCreateTaskOpen(true)}
          compact={compact}
          tooltip={t('createTaskTooltip')}
        >
          <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
          {!compact && t('createTask')}
        </Pill>

        <AssignPill
          open={assignOpen}
          onOpenChange={setAssignOpen}
          assignedTo={assignedTo}
          assigning={assigning}
          onAssign={handleAssign}
          compact={compact}
        />

        <Pill
          onClick={isArchived ? handleUnarchive : () => setConfirmArchiveOpen(true)}
          disabled={archiving}
          loading={archiving}
          compact={compact}
          tooltip={isArchived ? t('archiveTooltipUnarchive') : t('archiveTooltipArchive')}
        >
          <Archive
            className={cn('h-3.5 w-3.5', isArchived ? 'text-amber-500' : 'text-muted-foreground')}
          />
          {!compact && (isArchived ? t('unarchive') : t('archive'))}
        </Pill>

        <Pill
          onClick={() => setConfirmDeleteOpen(true)}
          disabled={deleting}
          loading={deleting}
          compact={compact}
          tooltip={t('deleteTooltip')}
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
          {!compact && t('delete')}
        </Pill>

        <ConfirmDialog
          open={confirmArchiveOpen}
          onOpenChange={setConfirmArchiveOpen}
          title={t('confirmArchiveTitle')}
          description={t('confirmArchiveDescription')}
          confirmLabel={t('confirmArchiveAction')}
          icon={Archive}
          onConfirm={handleArchiveConfirmed}
        />

        <ConfirmDialog
          open={confirmDeleteOpen}
          onOpenChange={setConfirmDeleteOpen}
          title={t('confirmDeleteTitle')}
          description={t('confirmDeleteDescription')}
          confirmLabel={t('confirmDeleteAction')}
          variant="destructive"
          icon={Trash2}
          onConfirm={handleDeleteConfirmed}
        />

        <NewTaskDialog
          open={createTaskOpen}
          onOpenChange={setCreateTaskOpen}
          {...(contactId ? { defaultContactId: contactId } : {})}
          {...(conversationId ? { defaultConversationId: conversationId } : {})}
          {...(contactName ? { defaultTitle: t('followUpTitle', { name: contactName }) } : {})}
          onCreated={() => {
            onAction?.('create-task');
            toast.success(t('taskCreatedTitle'), {
              description: t('taskCreatedDesc'),
            });
          }}
        />
      </div>
    </TooltipProvider>
  );
}

interface PillProps {
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
  compact?: boolean;
  tooltip?: string;
}

function Pill({ onClick, disabled, loading, children, compact = false, tooltip }: PillProps) {
  const button = (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      variant="ghost"
      size="sm"
      className={cn(
        'gap-1.5 rounded-full border border-transparent text-xs',
        compact ? 'h-7 w-7 p-0' : 'h-7 px-2.5',
        'hover:border-border hover:bg-card disabled:opacity-50',
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {!loading && children}
      {loading && <span className="opacity-60">{children}</span>}
    </Button>
  );

  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

interface AssignPillProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignedTo: string | null;
  assigning: boolean;
  onAssign: (userId: string | null) => void;
  compact?: boolean;
}

function AssignPill({ open, onOpenChange, assignedTo, assigning, onAssign, compact = false }: AssignPillProps) {
  const t = useTranslations('chat.actions');
  const { members, loading } = useTeamMembers();
  const containerRef = useRef<HTMLDivElement>(null);

  const current = members.find((m) => m.user_id === assignedTo) ?? null;

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, onOpenChange]);

  return (
    <div ref={containerRef} className="relative">
      <Pill
        onClick={() => onOpenChange(!open)}
        disabled={assigning}
        loading={assigning}
        compact={compact}
        tooltip={
          current
            ? t('assignTooltipAssigned', { name: current.display_name ?? current.email ?? t('assignedFallback') })
            : t('assignTooltipNone')
        }
      >
        <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
        {!compact && (current
          ? (current.display_name ?? current.email ?? t('assignedBtn'))
          : t('assign'))}
      </Pill>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-30 mb-1 w-64 overflow-hidden rounded-md border border-border bg-popover shadow-lg"
        >
          <div className="border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('assignedTitle')}
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {loading && (
              <div className="flex items-center justify-center px-3 py-4 text-xs text-muted-foreground">
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                {t('loadingMembers')}
              </div>
            )}

            {!loading && members.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {t('noMembers')}
              </p>
            )}

            {!loading &&
              members.map((m) => {
                const selected = m.user_id === assignedTo;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="menuitem"
                    onClick={() => onAssign(m.user_id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                      selected ? 'bg-primary/10' : 'hover:bg-muted',
                    )}
                  >
                    <InitialsAvatar
                      name={m.display_name ?? m.email}
                      src={m.avatar_url}
                      className="h-6 w-6 text-[10px]"
                    />
                    <div className="flex flex-1 flex-col min-w-0">
                      <span className="truncate font-medium">
                        {m.display_name ?? m.email ?? t('memberNoName')}
                      </span>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {m.role}
                      </span>
                    </div>
                    {selected && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                );
              })}
          </div>

          {assignedTo && (
            <button
              type="button"
              onClick={() => onAssign(null)}
              className="block w-full border-t border-border px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10"
            >
              {t('unassign')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function extractMessage(
  err: unknown,
  t: (key: string) => string,
): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return t('errorUnknown');
}
