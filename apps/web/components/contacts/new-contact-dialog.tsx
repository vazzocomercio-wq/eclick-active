'use client';

import { useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { contactsApi, type CreateContactDto } from '@/lib/api/contacts';
import { VerifyWhatsAppButton } from '@/components/contacts/verify-whatsapp-button';
import { parseTagsInput } from '@/lib/format';
import { ApiError } from '@/lib/api/client';

interface NewContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface FormState {
  name: string;
  phone: string;
  email: string;
  company: string;
  tags: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  phone: '',
  email: '',
  company: '',
  tags: '',
  notes: '',
};

export function NewContactDialog({ open, onOpenChange, onCreated }: NewContactDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function reset() {
    setForm(EMPTY_FORM);
    setErrors({});
    setServerError(null);
  }

  function validate(): boolean {
    const next: typeof errors = {};
    const hasIdentifier = Boolean(form.name || form.phone || form.email);
    if (!hasIdentifier) {
      next.name = 'Informe ao menos nome, telefone ou email';
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      next.email = 'Email inválido';
    }
    if (form.phone && form.phone.replace(/\D/g, '').length < 8) {
      next.phone = 'Telefone muito curto';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setServerError(null);

    const dto: CreateContactDto = {
      name: form.name || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      tags: form.tags ? parseTagsInput(form.tags) : undefined,
      source: 'manual',
      // `company` e `notes` não vão direto pro Contact — guardamos em
      // custom_fields. (criar empresa via /companies fica pra próxima.)
      custom_fields:
        form.company || form.notes
          ? {
              ...(form.company ? { company_name: form.company } : {}),
              ...(form.notes ? { notes: form.notes } : {}),
            }
          : undefined,
    };

    try {
      await contactsApi.create(dto);
      reset();
      onCreated();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(`${err.status}: ${err.message}`);
      } else {
        setServerError(err instanceof Error ? err.message : 'Erro desconhecido');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!submitting) {
          onOpenChange(o);
          if (!o) reset();
        }
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Novo contato</DialogTitle>
            <DialogDescription>
              Pelo menos um identificador (nome, telefone ou email) é obrigatório.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nome" error={errors.name}>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="João Silva"
                autoFocus
              />
            </Field>
            <Field label="Telefone" error={errors.phone}>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+55 71 99999-9999"
                inputMode="tel"
              />
              <div className="mt-1">
                <VerifyWhatsAppButton mode="phone" phone={form.phone} hideWhenEmpty />
              </div>
            </Field>
            <Field label="Email" error={errors.email} className="sm:col-span-2">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="joao@empresa.com"
              />
            </Field>
            <Field label="Empresa" className="sm:col-span-2">
              <Input
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                placeholder="Acme Inc."
              />
            </Field>
            <Field
              label="Tags"
              hint="Separe por vírgula. Ex: vip, lead-quente"
              className="sm:col-span-2"
            >
              <Input
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="vip, lead-quente"
              />
            </Field>
            <Field label="Notas" className="sm:col-span-2">
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Notas internas sobre o contato..."
                rows={3}
              />
            </Field>
          </div>

          {serverError && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {serverError}
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
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitting ? 'Criando...' : 'Criar contato'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}

function Field({ label, hint, error, className, children }: FieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!error && hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
