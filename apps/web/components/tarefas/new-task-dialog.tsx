'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Contact, TaskPriority, TaskType } from '@eclick-active/shared';
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
import { tasksApi, type CreateTaskInput } from '@/lib/api/tasks';
import { contactsApi } from '@/lib/api/contacts';
import { dealsApi } from '@/lib/api/deals';
import { ApiError } from '@/lib/api/client';
import { useDebounce } from '@/lib/use-debounce';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import {
  TASK_PRIORITY_VALUES,
  TASK_TYPE_VALUES,
} from './task-badges';

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pré-preenche um contato (quando aberto a partir de uma conversa/contato) */
  defaultContactId?: string;
  /** Pré-preenche um deal */
  defaultDealId?: string;
  /** Pré-preenche a data (YYYY-MM-DD) — usado pelo calendário */
  defaultDueDate?: string;
  /** Pré-preenche a hora (HH:mm) — usado pelo calendário (visão Semana/Dia) */
  defaultDueTime?: string;
  /** Pré-preenche o título (ex: "Follow-up com {nome do contato}") */
  defaultTitle?: string;
  /** Vincula a tarefa a uma conversa (preserva contexto pra histórico) */
  defaultConversationId?: string;
  onCreated: () => void;
}

interface FormState {
  title: string;
  description: string;
  task_type: TaskType;
  priority: TaskPriority;
  due_date: string;
  due_time: string;
  contact_id: string | null;
  contact_name: string;
  deal_id: string | null;
  deal_title: string;
}

const EMPTY: FormState = {
  title: '',
  description: '',
  task_type: 'follow_up',
  priority: 'normal',
  due_date: '',
  due_time: '',
  contact_id: null,
  contact_name: '',
  deal_id: null,
  deal_title: '',
};

export function NewTaskDialog({
  open,
  onOpenChange,
  defaultContactId,
  defaultDealId,
  defaultDueDate,
  defaultDueTime,
  defaultTitle,
  defaultConversationId,
  onCreated,
}: NewTaskDialogProps) {
  const t = useTranslations('tarefas.dialog');
  const tType = useTranslations('tarefas.badges.type');
  const tPriority = useTranslations('tarefas.badges.priority');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Reset on open + load current user
  useEffect(() => {
    if (!open) return;
    setForm({
      ...EMPTY,
      title: defaultTitle ?? '',
      contact_id: defaultContactId ?? null,
      deal_id: defaultDealId ?? null,
      due_date: defaultDueDate ?? '',
      due_time: defaultDueTime ?? '',
    });
    setServerError(null);

    // Carrega o user pra usar como assigned_to default
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) setCurrentUserId(data.user.id);
    });
  }, [open, defaultContactId, defaultDealId, defaultDueDate, defaultDueTime, defaultTitle]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !currentUserId) return;
    setSubmitting(true);
    setServerError(null);

    let dueIso: string | undefined;
    if (form.due_date) {
      const time = form.due_time || '23:59';
      const local = new Date(`${form.due_date}T${time}:00`);
      if (!Number.isNaN(local.getTime())) {
        dueIso = local.toISOString();
      }
    }

    const dto: CreateTaskInput = {
      title: form.title.trim(),
      task_type: form.task_type,
      priority: form.priority,
      assigned_to: currentUserId,
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.contact_id ? { contact_id: form.contact_id } : {}),
      ...(form.deal_id ? { deal_id: form.deal_id } : {}),
      ...(defaultConversationId ? { conversation_id: defaultConversationId } : {}),
      ...(dueIso ? { due_date: dueIso } : {}),
    };

    try {
      await tasksApi.create(dto);
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setServerError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : t('errorDefault'),
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
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>
              {t('description')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('fields.title')} required className="sm:col-span-2">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={t('fields.titlePlaceholder')}
                autoFocus
                required
              />
            </Field>

            <Field label={t('fields.type')}>
              <select
                value={form.task_type}
                onChange={(e) =>
                  setForm({ ...form, task_type: e.target.value as TaskType })
                }
                className={cn(
                  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              >
                {TASK_TYPE_VALUES.map((tt) => (
                  <option key={tt} value={tt}>
                    {tType(tt)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t('fields.priority')}>
              <select
                value={form.priority}
                onChange={(e) =>
                  setForm({ ...form, priority: e.target.value as TaskPriority })
                }
                className={cn(
                  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              >
                {TASK_PRIORITY_VALUES.map((p) => (
                  <option key={p} value={p}>
                    {tPriority(p)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t('fields.description')} className="sm:col-span-2">
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={t('fields.descriptionPlaceholder')}
                rows={2}
              />
            </Field>

            <Field label={t('fields.date')}>
              <Input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </Field>

            <Field label={t('fields.time')}>
              <Input
                type="time"
                value={form.due_time}
                onChange={(e) => setForm({ ...form, due_time: e.target.value })}
                disabled={!form.due_date}
              />
            </Field>

            <Field label={t('fields.linkContact')} className="sm:col-span-2">
              <ContactPicker
                value={form.contact_id}
                displayName={form.contact_name}
                onChange={(id, name) =>
                  setForm({ ...form, contact_id: id, contact_name: name })
                }
              />
            </Field>

            <Field label={t('fields.linkDeal')} className="sm:col-span-2">
              <DealPicker
                value={form.deal_id}
                displayTitle={form.deal_title}
                onChange={(id, title) =>
                  setForm({ ...form, deal_id: id, deal_title: title })
                }
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
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={submitting || !form.title.trim() || !currentUserId}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitting ? t('creating') : t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// Contact picker (debounced via /contacts/search)
// ──────────────────────────────────────────────────────────

function ContactPicker({
  value,
  displayName,
  onChange,
}: {
  value: string | null;
  displayName: string;
  onChange: (id: string | null, name: string) => void;
}) {
  const t = useTranslations('tarefas.dialog.contactPicker');
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
        <span className="truncate">{displayName || t('selected')}</span>
        <button
          type="button"
          onClick={() => onChange(null, '')}
          className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t('removeAria')}
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
        placeholder={t('placeholder')}
        className="pl-9"
      />
      {open && debounced.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {searching ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{t('searching')}</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{t('noResults')}</div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c.id, c.name ?? c.phone ?? c.email ?? t('noName'));
                  setQuery('');
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="truncate font-medium">
                  {c.name ?? <span className="italic text-muted-foreground">{t('noName')}</span>}
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
// Deal picker (lista top 50 + filtro client-side)
// ──────────────────────────────────────────────────────────

interface DealLite {
  id: string;
  title: string;
  value: number;
  currency: string;
}

function DealPicker({
  value,
  displayTitle,
  onChange,
}: {
  value: string | null;
  displayTitle: string;
  onChange: (id: string | null, title: string) => void;
}) {
  const t = useTranslations('tarefas.dialog.dealPicker');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [allDeals, setAllDeals] = useState<DealLite[]>([]);
  const [loading, setLoading] = useState(false);

  // Carrega top 50 deals na primeira abertura
  useEffect(() => {
    if (!open || allDeals.length > 0 || value) return;
    setLoading(true);
    void (async () => {
      try {
        const result = await dealsApi.list({ limit: 50 });
        setAllDeals(
          result.data.map((d) => ({
            id: d.id,
            title: d.title,
            value: d.value,
            currency: d.currency,
          })),
        );
      } catch {
        setAllDeals([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, allDeals.length, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm">
        <span className="truncate">{displayTitle || t('selected')}</span>
        <button
          type="button"
          onClick={() => onChange(null, '')}
          className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t('removeAria')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? allDeals.filter((d) => d.title.toLowerCase().includes(q)).slice(0, 10)
    : allDeals.slice(0, 10);

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
        placeholder={t('placeholder')}
        className="pl-9"
      />
      {open && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{t('loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{t('noResults')}</div>
          ) : (
            <>
              {q.length === 0 && (
                <div className="border-b border-border px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t('recent')}
                </div>
              )}
              {filtered.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    onChange(d.id, d.title);
                    setQuery('');
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="truncate font-medium">{d.title}</span>
                  {d.value > 0 && (
                    <span className="shrink-0 text-[11px] tabular-nums text-accent">
                      {d.value.toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: d.currency || 'BRL',
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Field
// ──────────────────────────────────────────────────────────

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}
