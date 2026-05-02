'use client';

import { useState } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Button } from './button';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Título — em geral em forma de pergunta ("Arquivar conversa?") */
  title: string;
  /** Texto explicativo, opcional */
  description?: string;
  /** Texto do botão de confirmação. Default: "Confirmar" */
  confirmLabel?: string;
  /** Texto do botão de cancelar. Default: "Cancelar" */
  cancelLabel?: string;
  /**
   * Variant visual da ação:
   *  - 'default': cyan (primário) — use pra ações neutras (arquivar, salvar)
   *  - 'destructive': vermelho — use pra ações irreversíveis (apagar, ban)
   */
  variant?: 'default' | 'destructive';
  /** Ícone opcional no canto superior esquerdo do header */
  icon?: LucideIcon;
  /**
   * Handler de confirmação. Pode ser async — o dialog mostra spinner enquanto
   * a Promise pendura. Se não rejeitar, o dialog fecha. Se rejeitar, o dialog
   * permanece aberto (caller é responsável por mostrar toast/erro).
   */
  onConfirm: () => void | Promise<void>;
}

/**
 * Diálogo de confirmação reutilizável usando Dialog do shadcn/Radix.
 * Substitui `window.confirm()` em qualquer lugar — mantém o tema do app
 * (dark/light, cyan accent) e bloqueia interação até resposta do usuário.
 *
 * Uso:
 *   const [open, setOpen] = useState(false);
 *   ...
 *   <ConfirmDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="Arquivar conversa?"
 *     description="Some da inbox. Pode ser recuperada em 'Arquivadas'."
 *     onConfirm={async () => { await api.archive(id) }}
 *   />
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'default',
  icon: Icon,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Caller mostra toast/erro. Mantém aberto pra usuário tentar de novo.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {Icon && (
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  variant === 'destructive'
                    ? 'bg-destructive/15 text-destructive'
                    : 'bg-primary/15 text-primary',
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
            )}
            <span>{title}</span>
          </DialogTitle>
          {description && (
            <DialogDescription className="pt-1.5 leading-relaxed">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            variant={variant === 'destructive' ? 'destructive' : 'default'}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
