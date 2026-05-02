'use client';

import { useEffect, useRef, useState } from 'react';
import {
  PLACEHOLDER_CATALOG,
  resolvePlaceholders,
  type PlaceholderCatalogItem,
  type PlaceholderContext,
} from '@eclick-active/shared';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface PlaceholderInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
  /**
   * Quando passado, mostra preview ao lado do input com o template resolvido
   * usando dados de exemplo (override do `previewContext` default).
   */
  previewContext?: PlaceholderContext;
  /** Mostrar preview da string resolvida embaixo do input. Default: true. */
  showPreview?: boolean;
  /** Filtra catalogo (ex: só permitir contato.* numa edição de mensagem). */
  catalogFilter?: PlaceholderCatalogItem['category'][];
}

/**
 * Textarea que detecta `{{` e abre dropdown agrupado por categoria com
 * placeholders disponíveis. Usado em:
 *   - Editor de automações (action send_message)
 *   - Templates de mensagem
 *   - Editor de email (subject + body, futuro)
 *
 * Comportamento:
 *   - Digitar `{{` abre dropdown abaixo do cursor
 *   - Setas ↑↓ navegam, Enter insere, Esc fecha
 *   - Click no item insere o token e fecha
 *   - Após inserir, foco volta pro textarea
 *   - Preview embaixo (live) com dados de exemplo
 */
export function PlaceholderInput({
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled,
  className,
  previewContext,
  showPreview = true,
  catalogFilter,
}: PlaceholderInputProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const catalog = catalogFilter
    ? PLACEHOLDER_CATALOG.filter((p) => catalogFilter.includes(p.category))
    : PLACEHOLDER_CATALOG;

  const grouped = groupBy(catalog, (p) => p.category);

  // Detecta `{{` (sem categoria.campo depois) — abre dropdown
  function checkOpen(text: string, caret: number) {
    const before = text.slice(0, caret);
    const lastOpen = before.lastIndexOf('{{');
    const lastClose = before.lastIndexOf('}}');
    if (lastOpen > lastClose && lastOpen >= 0) {
      // Abriu `{{` e ainda não fechou — só mostra se não tem `.field` completo já
      const fragment = before.slice(lastOpen);
      if (!/\}\}\s*$/.test(fragment)) {
        setOpen(true);
        setHighlight(0);
        return;
      }
    }
    setOpen(false);
  }

  function insertToken(token: string) {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? value.length;
    // Encontra o `{{` ainda aberto e substitui o trecho `{{...` por `token`
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const lastOpen = before.lastIndexOf('{{');
    const head = before.slice(0, lastOpen);
    const next = `${head}${token}${after}`;
    onChange(next);
    setOpen(false);
    // Foco + cursor após o token inserido
    requestAnimationFrame(() => {
      ta.focus();
      const pos = head.length + token.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, catalog.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = catalog[highlight];
      if (item) insertToken(item.token);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  // Click outside fecha
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!taRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const preview = showPreview
    ? resolvePlaceholders(value, previewContext ?? SAMPLE_CONTEXT, { missing: 'keep' })
    : null;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="relative">
        <Textarea
          ref={taRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            checkOpen(e.target.value, e.target.selectionStart ?? 0);
          }}
          onKeyDown={onKeyDown}
          onClick={(e) => {
            const ta = e.currentTarget;
            checkOpen(ta.value, ta.selectionStart ?? 0);
          }}
          placeholder={placeholder ?? 'Digite o texto. Use {{ pra inserir variáveis.'}
          rows={rows}
          disabled={disabled}
          className="resize-none font-sans text-sm"
        />

        {open && (
          <div
            role="listbox"
            className="absolute left-0 top-full z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
          >
            {Array.from(grouped.entries()).map(([category, items]) => (
              <div key={category} className="border-b border-border last:border-0">
                <div className="border-b border-border bg-muted/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {CATEGORY_LABEL[category] ?? category}
                </div>
                {items.map((item) => {
                  const idx = catalog.indexOf(item);
                  const active = idx === highlight;
                  return (
                    <button
                      key={item.token}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => insertToken(item.token)}
                      onMouseEnter={() => setHighlight(idx)}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs transition-colors',
                        active ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                      )}
                    >
                      <span className="font-medium">{item.label}</span>
                      <code className="text-[10px] text-muted-foreground">
                        {item.token}
                      </code>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {showPreview && preview !== null && value.includes('{{') && (
        <div className="rounded-md border border-dashed border-border bg-card/50 px-2 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Preview (dados de exemplo)
          </span>
          <p className="mt-0.5 whitespace-pre-wrap text-xs">{preview}</p>
        </div>
      )}
    </div>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  deal: 'Deal',
  contato: 'Contato',
  empresa: 'Empresa',
  agente: 'Agente',
  custom: 'Campo Custom',
};

const SAMPLE_CONTEXT: PlaceholderContext = {
  deal: {
    titulo: 'Acme Corp · Plano Premium',
    valor: 8500,
    stage: 'Proposta Enviada',
    responsavel: 'Carlos Lima',
    numero: 142,
    ai_score: 72,
    ai_next_action: 'Ligar essa semana',
  },
  contato: {
    nome: 'João Silva',
    telefone: '5571999999999',
    email: 'joao@acmecorp.com',
    empresa: 'Acme Corp',
    temperatura: 'hot',
    ai_summary: 'Cliente interessado, com orçamento aprovado.',
  },
  empresa: {
    nome: 'Acme Corp',
    site: 'acmecorp.com',
    telefone: null,
    email: null,
  },
  agente: {
    nome: 'Carlos Lima',
    email: 'carlos@minhaempresa.com.br',
    telefone: null,
  },
};

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}
