'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Filter, Search, X } from 'lucide-react';
import type { DealRisk } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { BoardFilters } from '@/lib/api/pipelines';
import { cn } from '@/lib/utils';

interface BoardFiltersBarProps {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  /** Callback para abrir o command palette (Ctrl+K) */
  onOpenSearch: () => void;
}

type RiskOption = { value: DealRisk | null; key: 'all' | 'low' | 'medium' | 'high' | 'critical'; color: string };
const RISK_OPTIONS: RiskOption[] = [
  { value: null, key: 'all', color: 'bg-muted text-muted-foreground' },
  { value: 'low', key: 'low', color: 'bg-emerald-500/15 text-emerald-400' },
  { value: 'medium', key: 'medium', color: 'bg-yellow-500/15 text-yellow-400' },
  { value: 'high', key: 'high', color: 'bg-orange-500/15 text-orange-400' },
  { value: 'critical', key: 'critical', color: 'bg-red-500/15 text-red-400' },
];

export function BoardFiltersBar({ filters, onChange, onOpenSearch }: BoardFiltersBarProps) {
  const t = useTranslations('funis.board.filters');
  const [expanded, setExpanded] = useState(false);
  const [tagsInput, setTagsInput] = useState((filters.tags ?? []).join(', '));
  const [minValue, setMinValue] = useState(filters.min_value?.toString() ?? '');
  const [maxValue, setMaxValue] = useState(filters.max_value?.toString() ?? '');

  // Sincroniza inputs quando filters mudam externamente
  useEffect(() => {
    setTagsInput((filters.tags ?? []).join(', '));
    setMinValue(filters.min_value?.toString() ?? '');
    setMaxValue(filters.max_value?.toString() ?? '');
  }, [filters]);

  const activeCount = countActive(filters);

  function applyTextFilters() {
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    onChange({
      ...filters,
      tags: tags.length > 0 ? tags : undefined,
      min_value: minValue.trim() ? Number(minValue) : undefined,
      max_value: maxValue.trim() ? Number(maxValue) : undefined,
    });
  }

  function clearAll() {
    onChange({});
    setTagsInput('');
    setMinValue('');
    setMaxValue('');
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-background/50 px-6 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenSearch}
          className="h-8 gap-1.5 text-muted-foreground"
        >
          <Search className="h-3.5 w-3.5" />
          {t('search')}
          <kbd className="ml-2 hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono sm:inline-block">
            Ctrl+K
          </kbd>
        </Button>

        <span className="ml-1 h-5 w-px bg-border" />

        <Button
          variant={expanded ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          className="h-8 gap-1.5"
        >
          <Filter className="h-3.5 w-3.5" />
          {t('filters')}
          {activeCount > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {activeCount}
            </span>
          )}
        </Button>

        {/* Risk pill quick-select sempre visível */}
        <div className="flex items-center gap-1">
          {RISK_OPTIONS.map((opt) => {
            const active = (filters.risk ?? null) === opt.value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() =>
                  onChange({ ...filters, risk: opt.value ?? undefined })
                }
                className={cn(
                  'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                  active ? opt.color : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {t(`risk.${opt.key}`)}
              </button>
            );
          })}
        </div>

        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="ml-auto h-8 gap-1 text-xs text-muted-foreground"
          >
            <X className="h-3 w-3" />
            {t('clear')}
          </Button>
        )}
      </div>

      {expanded && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card/50 p-3 sm:grid-cols-3">
          <FilterField label={t('tagsLabel')}>
            <Input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              onBlur={applyTextFilters}
              onKeyDown={(e) => e.key === 'Enter' && applyTextFilters()}
              placeholder={t('tagsPlaceholder')}
              className="h-8 text-xs"
            />
          </FilterField>

          <FilterField label={t('minValue')}>
            <Input
              type="number"
              value={minValue}
              onChange={(e) => setMinValue(e.target.value)}
              onBlur={applyTextFilters}
              onKeyDown={(e) => e.key === 'Enter' && applyTextFilters()}
              placeholder={t('minValuePlaceholder')}
              className="h-8 text-xs"
              inputMode="decimal"
            />
          </FilterField>

          <FilterField label={t('maxValue')}>
            <Input
              type="number"
              value={maxValue}
              onChange={(e) => setMaxValue(e.target.value)}
              onBlur={applyTextFilters}
              onKeyDown={(e) => e.key === 'Enter' && applyTextFilters()}
              placeholder={t('maxValuePlaceholder')}
              className="h-8 text-xs"
              inputMode="decimal"
            />
          </FilterField>
        </div>
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function countActive(f: BoardFilters): number {
  let n = 0;
  if (f.assigned_to) n++;
  if (f.tags && f.tags.length > 0) n++;
  if (typeof f.min_value === 'number') n++;
  if (typeof f.max_value === 'number') n++;
  if (f.risk) n++;
  return n;
}
