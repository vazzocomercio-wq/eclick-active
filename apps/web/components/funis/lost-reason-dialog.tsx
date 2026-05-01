'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface LostReasonDialogProps {
  open: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function LostReasonDialog({ open, onConfirm, onCancel }: LostReasonDialogProps) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length === 0) return;
    onConfirm(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <form onSubmit={handleConfirm} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              Marcar como perdido
            </DialogTitle>
            <DialogDescription>
              Por que esse negócio foi perdido? O motivo entra na timeline e ajuda a IA a
              aprender padrões de perda.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex: cliente fechou com concorrente por preço; orçamento não aprovado..."
            rows={4}
            autoFocus
            required
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit" disabled={reason.trim().length === 0}>
              Confirmar perda
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
