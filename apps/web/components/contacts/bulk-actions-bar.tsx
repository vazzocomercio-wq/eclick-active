'use client';

import { useState } from 'react';
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
      toast.success(
        `${data.enqueued} contato(s) na fila de verificação`,
        { description: 'A IA vai checar o WhatsApp em background. Pode demorar até 1 min.' },
      );
      onClear();
      // Refetch após pequeno delay pra primeiros resultados aparecerem
      setTimeout(() => void onChanged(), 3000);
    } catch (err) {
      toast.error('Falha ao enfileirar verificação', {
        description: err instanceof ApiError ? err.message : (err instanceof Error ? err.message : undefined),
      });
    } finally {
      setVerifying(false);
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Excluir ${count} contato(s)?`,
      description:
        'Esta ação é PERMANENTE. Conversas, deals e mensagens vinculadas a esses contatos também serão removidos. Não dá pra desfazer.',
      confirmLabel: 'Sim, excluir',
      cancelLabel: 'Cancelar',
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
        toast.success(`${success} contato(s) excluído(s)`);
      }
      if (failed > 0) {
        toast.error(`${failed} contato(s) falharam`, {
          description: 'Alguns podem ter deals ativos vinculados. Verifique e tente novamente.',
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
          aria-label="Limpar seleção"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-primary/20"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <span className="font-medium">
          {count} contato{count > 1 ? 's' : ''} selecionado{count > 1 ? 's' : ''}
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
          Verificar WhatsApp
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled
          className="gap-1.5 opacity-50"
          title="Em breve"
        >
          <Tag className="h-3.5 w-3.5" />
          Adicionar tag
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
          Excluir
        </Button>
      </div>
    </div>
  );
}

