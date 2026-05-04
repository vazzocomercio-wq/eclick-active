'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { tagsApi, type TagDefinition, type TagEntityType } from '@/lib/api/tags';
import { TagPills } from '@/components/contacts/tag-pills';
import { cn } from '@/lib/utils';

interface TagPickerProps {
  /** Slugs atualmente aplicados ao contato/deal. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Determina qual catálogo carregar e onde criar tags novas. */
  entityType: TagEntityType;
  /**
   * Se true, permite criar tag inline quando o usuário digita uma slug
   * que ainda não existe no catálogo. Default true.
   */
  allowCreate?: boolean;
  className?: string;
  placeholder?: string;
}

/**
 * Input com autocomplete pra adicionar/remover tags. Carrega o catálogo
 * da org (via tagsApi.list) e mostra sugestões enquanto o user digita.
 * Permite criar tag inline (slug normalizado) quando não existe no catálogo
 * — backend cria automaticamente via POST /tags ou via Concierge.
 *
 * Uso:
 *   <TagPicker entityType="deal" value={tags} onChange={setTags} />
 */
export function TagPicker({
  value,
  onChange,
  entityType,
  allowCreate = true,
  className,
  placeholder = 'Adicionar tag…',
}: TagPickerProps) {
  const [definitions, setDefinitions] = useState<TagDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    tagsApi
      .list({ entity_type: entityType })
      .then((list) => {
        if (!cancelled) setDefinitions(list);
      })
      .catch(() => {
        if (!cancelled) setDefinitions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType]);

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Sugestões: filtra catálogo por search, exclui slugs já aplicados
  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    return definitions
      .filter((d) => !value.includes(d.slug))
      .filter(
        (d) =>
          q === '' ||
          d.label.toLowerCase().includes(q) ||
          d.slug.toLowerCase().includes(q) ||
          (d.category ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [definitions, value, input]);

  // Permite criar tag nova quando o input não bate com nenhuma do catálogo
  const inputSlug = slugify(input);
  const canCreate =
    allowCreate &&
    inputSlug.length > 0 &&
    !value.includes(inputSlug) &&
    !definitions.some((d) => d.slug === inputSlug);

  function addTag(slug: string) {
    if (!slug || value.includes(slug)) return;
    onChange([...value, slug]);
    setInput('');
    inputRef.current?.focus();
  }

  function removeTag(slug: string) {
    onChange(value.filter((s) => s !== slug));
  }

  async function handleCreate() {
    if (!canCreate) return;
    const label = input.trim();
    try {
      // Cria no backend (label humanizado, slug auto). Atualiza catálogo local.
      const created = await tagsApi.create({
        entity_type: entityType,
        label,
      });
      setDefinitions((prev) => [created, ...prev]);
      addTag(created.slug);
    } catch {
      // Mesmo se falhar (offline, conflito), aplica o slug local — backend
      // upserta na próxima oportunidade via Concierge ou save manual
      addTag(inputSlug);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions[0]) {
        addTag(suggestions[0].slug);
      } else if (canCreate) {
        void handleCreate();
      }
    } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
      // Remove a última quando backspace em input vazio
      onChange(value.slice(0, -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Tags aplicadas + input */}
      <div
        className="flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring"
        onClick={() => inputRef.current?.focus()}
      >
        {value.length > 0 && (
          <TagPillsInteractive value={value} definitions={definitions} onRemove={removeTag} />
        )}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {/* Dropdown de sugestões */}
      {open && (loading || suggestions.length > 0 || canCreate) && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
          {loading && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Carregando…</div>
          )}
          {!loading && suggestions.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => addTag(d.slug)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted"
            >
              <TagPills tags={[d.slug]} definitions={[d]} max={1} />
              {d.category && (
                <span className="ml-auto text-[10px] text-muted-foreground">{d.category}</span>
              )}
            </button>
          ))}
          {!loading && canCreate && (
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-xs text-primary hover:bg-primary/5"
            >
              <Plus className="h-3 w-3" />
              Criar nova tag <strong className="font-mono">{inputSlug}</strong>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// TagPillsInteractive — variante removível pra input
// ──────────────────────────────────────────────────────────

function TagPillsInteractive({
  value,
  definitions,
  onRemove,
}: {
  value: string[];
  definitions: TagDefinition[];
  onRemove: (slug: string) => void;
}) {
  const defMap = new Map(definitions.map((d) => [d.slug, d]));
  return (
    <>
      {value.map((slug) => {
        const def = defMap.get(slug);
        return (
          <span
            key={slug}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 pl-2 pr-1 py-0.5 text-[11px] font-medium"
          >
            <TagPills tags={[slug]} definitions={def ? [def] : undefined} max={1} />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(slug);
              }}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label={`Remover ${slug}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
    </>
  );
}

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
