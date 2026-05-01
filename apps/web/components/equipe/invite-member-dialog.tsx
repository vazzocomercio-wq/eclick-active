'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { teamApi, type InviteMemberInput } from '@/lib/api/team';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { roleLabel } from './role-badge';

const ROLES: InviteMemberInput['role'][] = ['admin', 'manager', 'agent', 'viewer'];

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: () => void;
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  onInvited,
}: InviteMemberDialogProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<InviteMemberInput['role']>('agent');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail('');
      setName('');
      setRole('agent');
      setError(null);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await teamApi.invite({
        email: email.trim().toLowerCase(),
        role,
        ...(name.trim() ? { display_name: name.trim() } : {}),
      });
      onInvited();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao convidar',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Convidar membro</DialogTitle>
            <DialogDescription>
              O usuário receberá um magic link por email para acessar a organização.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Email <span className="text-destructive">*</span></Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="agente@empresa.com"
                required
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Nome (opcional)</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="João Silva"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Papel</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as InviteMemberInput['role'])}
                className={cn(
                  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">
                Apenas owner pode promover a admin depois.
              </p>
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting || !email.trim()}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitting ? 'Enviando convite...' : 'Convidar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
