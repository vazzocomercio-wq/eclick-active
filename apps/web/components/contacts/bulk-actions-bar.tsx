'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, Tag, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-provider';
import { contactsApi } from '@/lib/api/contacts';
import { ApiError } from '@/lib/api/client';

interface BulkActionsBarProps {
  selectedIds: Set<string>;
  onClear: () => void;
  /** Disparado quando uma ação altera o estado dos contatos — pai recarrega lista. */
  onChanged: () => void | Promise<void>;
}

/**
 * Barra fixa que aparece em cima da tabela quando há contatos selecionados.
 * Concentra ações em massa:
 *   - Verificar WhatsApp em batch (chama /contacts/verify-whatsapp/batch)
 *   - Excluir (com confirmação)
 *
 * Adicionar tag / mudar temperatura / exportar CSV ficam pra próxima
 * iteração — quando entregar pelos endpoints.
 */
export function BulkActionsBar({ selectedIds, onClear, onChanged }: BulkActionsBarProps) {
  const t = useTranslations('contacts.bulkActions');
  const confirm = useConfirm();
  const [verifying, setVerifying] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const count = selectedIds.size;
  if (count === 0) return null;

  async function handleVerifyWhatsApp() {
    setVerifying(true);
    try {
      const ids = Array.from(selectedIds);
      const data = await contactsApi.verifyWhatsappBatch(ids);
      toast.success(t('verifyEnqueuedTitle', { count: data.enqueued }), {
        description: t('verifyEnqueuedDescription'),
      });
      onClear();
      // Refetch após pequeno delay pra primeiros resultados aparecerem
      setTimeout(() => void onChanged(), 3000);
    } catch (err) {
      toast.error(t('verifyEnqueueFailed'), {
        description: err instanceof ApiError ? err.message : (err instanceof Error ? err.message : undefined),
      });
    } finally {
      setVerifying(false);
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: t('deleteConfirmTitle', { count }),
      description: t('deleteConfirmDescription'),
      confirmLabel: t('deleteConfirm'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    });
    if (!ok) return;

    setDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const results = await Promise.allSettled(
        ids.map((id) => contactsApi.remove(id)),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      const success = results.length - failed;
      if (success > 0) {
        toast.success(t('deleteSuccess', { count: success }));
      }
      if (failed > 0) {
        toast.error(t('deleteFailed', { count: failed }), {
          description: t('deleteFailedDescription'),
        });
      }
      onClear();
      await onChanged();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-primary/30 bg-primary/10 px-8 py-2.5 text-sm">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClear}
          aria-label={t('clearSelection')}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-primary/20"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <span className="font-medium">
          {count > 1 ? t('selectedMany', { count }) : t('selectedOne', { count })}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleVerifyWhatsApp}
          disabled={verifying || deleting}
          className="gap-1.5"
        >
          {verifying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          {t('verifyWhatsapp')}
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled
          className="gap-1.5 opacity-50"
          title={t('addTagSoonTitle')}
        >
          <Tag className="h-3.5 w-3.5" />
          {t('addTag')}
        </Button>

        <Button
          size="sm"
          variant="destructive"
          onClick={handleDelete}
          disabled={verifying || deleting}
          className="gap-1.5"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          {t('delete')}
        </Button>
      </div>
    </div>
  );
}

