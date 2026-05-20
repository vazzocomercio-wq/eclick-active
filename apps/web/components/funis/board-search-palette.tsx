'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import type { BoardDealItem } from '@/lib/api/pipelines';
import { cn } from '@/lib/utils';

interface BoardSearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lista linear de deals do board atual — busca client-side */
  deals: BoardDealItem[];
  onSelect: (dealId: string) => void;
}

const MAX_RESULTS = 10;

/**
 * Command palette estilo Cmd+K. Faz busca fuzzy simples (substring + token
 * matching) no title, contact_name e stage_name dos deals do board atual.
 */
export function BoardSearchPalette({
  open,
  onOpenChange,
  deals,
  onSelect,
}: BoardSearchPaletteProps) {
  const t = useTranslations('funis.board.search');
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // Foca após render
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const results = useMemo(() => filterDeals(deals, query), [deals, query]);

  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(0);
  }, [results.length, activeIndex]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[activeIndex];
      if (picked) {
        onSelect(picked.id);
        onOpenChange(false);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{t('title')}</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('placeholder')}
            className="h-12 flex-1 bg-transparent text-sm focus:outline-none"
          />
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground sm:inline-block">
            {t('esc')}
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {deals.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              {t('emptyFunnel')}
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              {t('noResults', { query })}
            </div>
          ) : (
            <ul>
              {results.map((d, i) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => {
                      onSelect(d.id);
                      onOpenChange(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                      i === activeIndex ? 'bg-accent/10' : 'hover:bg-muted/50',
                    )}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: d.stage_color }}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{d.title}</span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {d.contact_name ?? t('noContact')} · {d.stage_name}
                      </span>
                    </div>
                    {d.value > 0 && (
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-accent">
                        {formatBRL(d.value)}
                      </span>
                    )}
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-2 text-[10px] text-muted-foreground">
          <span>{t('footerHint')}</span>
          <span>{t('footerCount', { shown: results.length, total: deals.length })}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function filterDeals(deals: BoardDealItem[], query: string): BoardDealItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return deals.slice(0, MAX_RESULTS);
  }
  const tokens = q.split(/\s+/);
  const scored = deals
    .map((d) => {
      const haystack = [
        d.title,
        d.contact_name ?? '',
        d.stage_name,
        ...(d.tags ?? []),
      ]
        .join(' ')
        .toLowerCase();
      const allMatch = tokens.every((t) => haystack.includes(t));
      if (!allMatch) return null;
      // Score = soma das posições do match (menor = mais relevante)
      const score = tokens.reduce((acc, t) => {
        const idx = haystack.indexOf(t);
        return acc + (idx === -1 ? 999 : idx);
      }, 0);
      return { deal: d, score };
    })
    .filter((x): x is { deal: BoardDealItem; score: number } => x !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_RESULTS)
    .map((x) => x.deal);

  return scored;
}

function formatBRL(n: number): string {
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}
