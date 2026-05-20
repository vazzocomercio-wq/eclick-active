'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  automationsApi,
  type Automation,
  type AutomationAction,
} from '@/lib/api/automations';
import { ApiError } from '@/lib/api/client';
import { useConfirm } from '@/components/ui/confirm-provider';
import { cn } from '@/lib/utils';

interface StageAutomationsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stageId: string | null;
  stageName: string | null;
  onChanged?: () => void | Promise<void>;
}

/**
 * Sheet de "Automações do stage" — listagem + toggle + criação rápida.
 * Aberto a partir do `<PipelineConfigSheet>` quando o user clica em "⚡".
 *
 * MVP enxuto: só CRUD básico de uma automação simples (`deal_stage_changed`
 * trigger + `send_message` action). UX completa de "Descrever com IA" e
 * "Templates" são wire pra `automacoesApi.generate` (já existe) — fica
 * pra próximo refinement.
 */
export function StageAutomationsSheet({
  open,
  onOpenChange,
  stageId,
  stageName,
  onChanged,
}: StageAutomationsSheetProps) {
  const t = useTranslations('funis.automations');
  const [items, setItems] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(false);
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  async function reload() {
    if (!stageId) return;
    setLoading(true);
    try {
      const list = await automationsApi.list({ stageId });
      setItems(list);
    } catch (err) {
      toast.error(t('loadFailed'), { description: extractMessage(err, t('unknownError')) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && stageId) {
      void reload();
      setShowCreate(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stageId]);

  async function handleToggle(a: Automation) {
    try {
      await automationsApi.toggle(a.id);
      void reload();
      void onChanged?.();
    } catch (err) {
      toast.error(t('toggleFailed'), { description: extractMessage(err, t('unknownError')) });
    }
  }

  async function handleDelete(a: Automation) {
    const ok = await confirm({
      title: t('confirmDeleteTitle', { name: a.name }),
      description: t('confirmDeleteDescription'),
      variant: 'destructive',
      confirmLabel: t('confirmDeleteLabel'),
      icon: Trash2,
    });
    if (!ok) return;
    try {
      await automationsApi.remove(a.id);
      toast.success(t('deleted'));
      void reload();
      void onChanged?.();
    } catch (err) {
      toast.error(t('deleteFailed'), { description: extractMessage(err, t('unknownError')) });
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-lg flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            {t('title')}
          </SheetTitle>
          <SheetDescription>
            {stageName ? <strong>{stageName}</strong> : t('subtitleStageFallback')} ·{' '}
            {items.length === 1
              ? t('subtitleOne', { count: items.length })
              : t('subtitleMany', { count: items.length })}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {items.length === 0 && !showCreate && (
                <p className="py-6 text-center text-xs italic text-muted-foreground">
                  {t('empty')}
                </p>
              )}

              <ul className="flex flex-col gap-2">
                {items.map((a) => (
                  <AutomationRow
                    key={a.id}
                    automation={a}
                    onToggle={() => void handleToggle(a)}
                    onDelete={() => void handleDelete(a)}
                  />
                ))}
              </ul>

              {showCreate && stageId && (
                <CreateForm
                  stageId={stageId}
                  creating={creating}
                  onSubmitting={setCreating}
                  onSaved={async () => {
                    setShowCreate(false);
                    await reload();
                    void onChanged?.();
                  }}
                  onCancel={() => setShowCreate(false)}
                />
              )}

              {!showCreate && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => setShowCreate(true)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  {t('newButton')}
                </Button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ──────────────────────────────────────────────────────────
// AutomationRow
// ──────────────────────────────────────────────────────────

function AutomationRow({
  automation,
  onToggle,
  onDelete,
}: {
  automation: Automation;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('funis.automations');
  return (
    <li
      className={cn(
        'flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2',
        automation.is_active ? 'border-border' : 'border-border/50 opacity-60',
      )}
    >
      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <span className="truncate text-sm font-medium">{automation.name}</span>
        <span className="text-[10px] text-muted-foreground">
          {automation.actions.length === 1
            ? t('rowMetaOneAction', {
                trigger: automation.trigger_type,
                actionCount: automation.actions.length,
                execs: automation.execution_count,
              })
            : t('rowMetaMany', {
                trigger: automation.trigger_type,
                actionCount: automation.actions.length,
                execs: automation.execution_count,
              })}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onToggle}
          aria-label={automation.is_active ? t('rowDeactivate') : t('rowActivate')}
          className={cn(
            'inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
            automation.is_active ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 rounded-full bg-background shadow transition-transform',
              automation.is_active ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('rowDelete')}
          className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

// ──────────────────────────────────────────────────────────
// CreateForm — form simples para criar automação stage-bound
// ──────────────────────────────────────────────────────────

function CreateForm({
  stageId,
  creating,
  onSubmitting,
  onSaved,
  onCancel,
}: {
  stageId: string;
  creating: boolean;
  onSubmitting: (v: boolean) => void;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations('funis.automations.form');
  const [name, setName] = useState('');
  const [message, setMessage] = useState(t('defaultMessage', { greetingContact: '{{contato.nome}}' }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !message.trim()) return;
    onSubmitting(true);
    try {
      const action: AutomationAction = {
        type: 'send_message',
        text: message.trim(),
      };
      await automationsApi.create({
        name: name.trim(),
        trigger_type: 'deal_stage_changed',
        trigger_config: {},
        actions: [action],
        is_active: true,
        stage_id: stageId,
      });
      toast.success(t('created'));
      await onSaved();
    } catch (err) {
      toast.error(t('createFailed'), { description: extractMessage(err, 'Error') });
    } finally {
      onSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 flex flex-col gap-3 rounded-md border border-primary/30 bg-primary/5 p-3"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
        {t('kicker')}
      </span>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">{t('nameLabel')}</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('namePlaceholder')}
          required
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs">
          {t('messageLabel')}
          <span className="ml-1 font-normal text-muted-foreground">
            {t('messageHint', { placeholderContact: '{{contato.nome}}', placeholderDeal: '{{deal.titulo}}' })}
          </span>
        </Label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          required
          className="resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={creating}>
          {t('cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={creating || !name.trim() || !message.trim()}>
          {creating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {t('create')}
        </Button>
      </div>
    </form>
  );
}

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return fallback;
}
