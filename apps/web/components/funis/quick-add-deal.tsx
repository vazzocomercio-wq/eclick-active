'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Contact } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { contactsApi } from '@/lib/api/contacts';
import { dealsApi } from '@/lib/api/deals';
import { ApiError } from '@/lib/api/client';
import { useDebounce } from '@/lib/use-debounce';
import { cn } from '@/lib/utils';

export interface QuickAddDealProps {
  pipelineId: string;
  stageId: string;
  /** Disparado após criar — pai recarrega o board. */
  onCreated: () => void | Promise<void>;
  onCancel: () => void;
  className?: string;
}

/**
 * Form inline compacto pra criar deal direto na coluna do Kanban.
 * Renderiza no topo da coluna com slide-down (controlado pelo pai).
 *
 * Fluxo:
 *   - Nome do negócio (auto-focus)
 *   - Valor (formatação simples R$ — aceita "8.500" ou "8500,00")
 *   - Contato: input com busca debounced em /contacts/search
 *     - Se selecionar resultado, vincula
 *     - Se não selecionar e for telefone, findOrCreateByPhone (cria contato novo)
 *     - Se não selecionar e for nome, cria contato novo só com nome
 *   - Enter cria; Esc cancela
 */
export function QuickAddDeal({
  pipelineId,
  stageId,
  onCreated,
  onCancel,
  className,
}: QuickAddDealProps) {
  const [title, setTitle] = useState('');
  const [valueStr, setValueStr] = useState('');
  const [contactQuery, setContactQuery] = useState('');
  const [pickedContact, setPickedContact] = useState<Contact | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Esc fecha
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      // 1. Resolve contact_id
      let contactId: string | undefined;
      if (pickedContact) {
        contactId = pickedContact.id;
      } else if (contactQuery.trim()) {
        contactId = await resolveContactId(contactQuery.trim());
      }

      // 2. Cria deal
      await dealsApi.create({
        title: title.trim(),
        pipeline_id: pipelineId,
        stage_id: stageId,
        value: parseValueBRL(valueStr),
        ...(contactId ? { contact_id: contactId } : {}),
      });

      toast.success('Negócio criado');
      await onCreated();
    } catch (err) {
      toast.error('Falha ao criar negócio', {
        description:
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro desconhecido',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'flex flex-col gap-1.5 rounded-md border border-primary/40 bg-background p-2 shadow-md',
        'animate-in slide-in-from-top-2 fade-in duration-200',
        className,
      )}
    >
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Novo negócio</span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancelar"
          className="rounded-md p-0.5 hover:bg-muted hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <Input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Nome do negócio"
        disabled={submitting}
        required
        className="h-8 text-xs"
      />

      <Input
        value={valueStr}
        onChange={(e) => setValueStr(e.target.value)}
        placeholder="R$ 0,00"
        disabled={submitting}
        inputMode="decimal"
        className="h-8 text-xs"
      />

      <ContactPicker
        query={contactQuery}
        onQueryChange={setContactQuery}
        picked={pickedContact}
        onPick={(c) => {
          setPickedContact(c);
          setContactQuery(c.name ?? c.phone ?? '');
        }}
        onClear={() => {
          setPickedContact(null);
          setContactQuery('');
        }}
        disabled={submitting}
      />

      <div className="flex items-center justify-end gap-1.5 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
          className="h-7 px-2 text-[11px]"
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!title.trim() || submitting}
          className="h-7 px-3 text-[11px]"
        >
          {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Criar (Enter)
        </Button>
      </div>
    </form>
  );
}

// ──────────────────────────────────────────────────────────
// ContactPicker — input com busca debounced
// ──────────────────────────────────────────────────────────

function ContactPicker({
  query,
  onQueryChange,
  picked,
  onPick,
  onClear,
  disabled,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  picked: Contact | null;
  onPick: (c: Contact) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const [results, setResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounced = useDebounce(query, 300);

  useEffect(() => {
    // Não busca se contato já selecionado (input mostra label)
    if (picked) {
      setResults([]);
      return;
    }
    const trimmed = debounced.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    contactsApi
      .search(trimmed, 8, ctrl.signal)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
    return () => ctrl.abort();
  }, [debounced, picked]);

  if (picked) {
    return (
      <div className="flex items-center justify-between rounded-md border border-input bg-muted/30 px-2 py-1 text-xs">
        <span className="truncate">
          {picked.name ?? picked.phone ?? 'Contato selecionado'}
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Trocar contato"
          disabled={disabled}
          className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Telefone ou nome do contato"
          disabled={disabled}
          className="h-8 pl-7 text-xs"
        />
      </div>
      {open && debounced.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover text-xs shadow-lg">
          {searching ? (
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground">Buscando...</div>
          ) : results.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
              Nenhum contato — será criado novo ao salvar
            </div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c)}
                className="flex w-full flex-col items-start gap-0 px-2 py-1.5 text-left hover:bg-muted"
              >
                <span className="truncate font-medium">
                  {c.name ?? <span className="italic text-muted-foreground">sem nome</span>}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">
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
// Helpers
// ──────────────────────────────────────────────────────────

/**
 * Decide se o que o user digitou é telefone ou nome:
 *   - Se pelo menos 8 dígitos contínuos → telefone, findOrCreateByPhone
 *   - Senão → nome, cria contato com source='manual'
 *
 * Em ambos os casos retorna o `contact_id`. Não joga toast — let caller decide.
 */
async function resolveContactId(input: string): Promise<string | undefined> {
  const digits = input.replace(/\D/g, '');
  if (digits.length >= 8) {
    // Tenta achar por telefone exato primeiro
    const found = await contactsApi.search(digits, 5).catch(() => []);
    const match = found.find((c) => c.phone && c.phone.replace(/\D/g, '') === digits);
    if (match) return match.id;
    // Cria novo
    const created = await contactsApi.create({
      phone: digits,
      source: 'manual',
    });
    return created.id;
  }

  // Trata como nome — cria contato sem telefone
  const created = await contactsApi.create({
    name: input,
    source: 'manual',
  });
  return created.id;
}

function parseValueBRL(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const cleaned = raw.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
