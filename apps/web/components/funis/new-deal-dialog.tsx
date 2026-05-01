'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import type { Contact } from '@eclick-active/shared';
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
import { dealsApi, type CreateDealInput } from '@/lib/api/deals';
import { contactsApi } from '@/lib/api/contacts';
import { ApiError } from '@/lib/api/client';
import { useDebounce } from '@/lib/use-debounce';
import { parseTagsInput } from '@/lib/format';
import type { PipelineWithStages } from '@/lib/api/pipelines';
import { cn } from '@/lib/utils';

interface NewDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: PipelineWithStages | null;
  /** Stage pré-selecionada (botão "+" da coluna) */
  defaultStageId?: string;
  onCreated: () => void;
}

interface FormState {
  title: string;
  value: string;
  contactId: string | null;
  contactName: string;
  stageId: string;
  expectedClose: string;
  tags: string;
}

const EMPTY: FormState = {
  title: '',
  value: '',
  contactId: null,
  contactName: '',
  stageId: '',
  expectedClose: '',
  tags: '',
};

export function NewDealDialog({
  open,
  onOpenChange,
  pipeline,
  defaultStageId,
  onCreated,
}: NewDealDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (open && pipeline) {
      const firstNormalStage = pipeline.stages.find((s) => !s.is_won && !s.is_lost);
      setForm({
        ...EMPTY,
        stageId: defaultStageId ?? firstNormalStage?.id ?? pipeline.stages[0]?.id ?? '',
      });
      setServerError(null);
    }
  }, [open, pipeline, defaultStageId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pipeline || !form.title.trim() || !form.stageId) return;
    setSubmitting(true);
    setServerError(null);

    const dto: CreateDealInput = {
      title: form.title.trim(),
      pipeline_id: pipeline.id,
      stage_id: form.stageId,
      ...(form.contactId ? { contact_id: form.contactId } : {}),
      ...(form.value ? { value: Number(form.value.replace(',', '.')) } : {}),
      ...(form.expectedClose ? { expected_close_date: form.expectedClose } : {}),
      ...(form.tags ? { tags: parseTagsInput(form.tags) } : {}),
    };

    try {
      await dealsApi.create(dto);
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setServerError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao criar deal',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Novo negócio</DialogTitle>
            <DialogDescription>
              {pipeline?.name ?? 'Selecione um pipeline primeiro'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Título" required className="sm:col-span-2">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Ex: Venda Acme — 50 licenças"
                autoFocus
                required
              />
            </Field>

            <Field label="Valor (R$)">
              <Input
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                inputMode="decimal"
                placeholder="0,00"
              />
            </Field>

            <Field label="Stage">
              <select
                value={form.stageId}
                onChange={(e) => setForm({ ...form, stageId: e.target.value })}
                className={cn(
                  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
                required
              >
                {pipeline?.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Contato" className="sm:col-span-2">
              <ContactPicker
                value={form.contactId}
                displayName={form.contactName}
                onChange={(id, name) =>
                  setForm({ ...form, contactId: id, contactName: name })
                }
              />
            </Field>

            <Field label="Data esperada de fechamento">
              <Input
                type="date"
                value={form.expectedClose}
                onChange={(e) => setForm({ ...form, expectedClose: e.target.value })}
              />
            </Field>

            <Field label="Tags" hint="Vírgula entre tags">
              <Input
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="lead-quente, b2b"
              />
            </Field>
          </div>

          {serverError && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {serverError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting || !form.title.trim() || !form.stageId}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitting ? 'Criando...' : 'Criar deal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// Contact picker — busca debounced em /contacts/search
// ──────────────────────────────────────────────────────────

interface ContactPickerProps {
  value: string | null;
  displayName: string;
  onChange: (id: string | null, name: string) => void;
}

function ContactPicker({ value, displayName, onChange }: ContactPickerProps) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 300);
  const [results, setResults] = useState<Contact[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (value || debounced.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    contactsApi
      .search(debounced.trim(), 10)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [debounced, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm">
        <span className="truncate">{displayName || 'Contato selecionado'}</span>
        <button
          type="button"
          onClick={() => onChange(null, '')}
          className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Remover contato"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Buscar contato (nome, telefone, email)..."
        className="pl-9"
      />
      {open && debounced.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {searching ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Buscando...</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum contato</div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c.id, c.name ?? c.phone ?? c.email ?? 'sem nome');
                  setQuery('');
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="truncate font-medium">
                  {c.name ?? <span className="italic text-muted-foreground">sem nome</span>}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {c.phone ?? c.email ?? '—'}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Field helper
// ──────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}

function Field({ label, required, hint, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
