'use client';

import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TaskType } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  type CalendarViewMode,
  dayLabel,
  monthYearLabel,
  weekRangeLabel,
} from './calendar-utils';

const VIEW_KEYS = ['day', 'week', 'month'] as const;
const TASK_TYPE_VALUES: TaskType[] = [
  'call',
  'meeting',
  'follow_up',
  'email',
  'whatsapp',
  'proposal',
  'custom',
];

interface CalendarHeaderProps {
  view: CalendarViewMode;
  current: Date;
  onlyMine: boolean;
  selectedTypes: TaskType[];
  onChangeView: (v: CalendarViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onChangeMine: (mine: boolean) => void;
  onToggleType: (type: TaskType) => void;
  onClearTypes: () => void;
  onNewTask: () => void;
  loading?: boolean;
}

export function CalendarHeader({
  view,
  current,
  onlyMine,
  selectedTypes,
  onChangeView,
  onPrev,
  onNext,
  onToday,
  onChangeMine,
  onToggleType,
  onClearTypes,
  onNewTask,
  loading,
}: CalendarHeaderProps) {
  const t = useTranslations('calendario');
  const periodLabel =
    view === 'month'
      ? monthYearLabel(current, (k) => t(k))
      : view === 'week'
        ? weekRangeLabel(current, (k) => t(k))
        : dayLabel(current, (k) => t(k));

  return (
    <header className="flex flex-col gap-3 border-b border-border bg-background px-4 py-3 md:px-6">
      {/* Linha 1 — título + nav + ações */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <h1 className="text-base font-semibold md:text-lg">{t('title')}</h1>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={onPrev}
            aria-label={t('prevPeriod')}
            disabled={loading}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[180px] px-2 text-center text-sm font-medium md:text-base">
            {periodLabel}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={onNext}
            aria-label={t('nextPeriod')}
            disabled={loading}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToday}
            disabled={loading}
            className="ml-1"
          >
            {t('today')}
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* View toggle — escondido em mobile (só Dia disponível) */}
          <div className="hidden items-center rounded-md border border-input bg-card p-0.5 md:inline-flex">
            {VIEW_KEYS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onChangeView(v)}
                className={cn(
                  'rounded px-3 py-1 text-xs font-medium transition-colors',
                  view === v
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`view.${v}`)}
              </button>
            ))}
          </div>

          <Button size="sm" onClick={onNewTask}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('newTask')}
          </Button>
        </div>
      </div>

      {/* Linha 2 — filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-xs">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(e) => onChangeMine(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input"
          />
          <span className="font-medium">{t('onlyMine')}</span>
        </label>

        <TypeMultiSelect
          selected={selectedTypes}
          onToggle={onToggleType}
          onClear={onClearTypes}
        />

        {loading && (
          <span className="ml-auto text-xs text-muted-foreground">
            {t('loading')}
          </span>
        )}
      </div>
    </header>
  );
}

function TypeMultiSelect({
  selected,
  onToggle,
  onClear,
}: {
  selected: TaskType[];
  onToggle: (t: TaskType) => void;
  onClear: () => void;
}) {
  const t = useTranslations('calendario');
  const label =
    selected.length === 0
      ? t('type.all')
      : selected.length === 1
        ? t(`type.${selected[0]}`)
        : t('type.countFormat', { n: selected.length });

  return (
    <details className="relative">
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-xs',
          'marker:hidden [&::-webkit-details-marker]:hidden',
        )}
      >
        <span className="text-muted-foreground">{t('type.label')}</span>
        <span className="font-medium">{label}</span>
      </summary>
      <div className="absolute z-20 mt-1 w-56 rounded-md border border-border bg-popover p-2 shadow-lg">
        <div className="flex flex-col gap-1">
          {TASK_TYPE_VALUES.map((v) => {
            const checked = selected.includes(v);
            return (
              <label
                key={v}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(v)}
                  className="h-3.5 w-3.5 rounded border-input"
                />
                <span>{t(`type.${v}`)}</span>
              </label>
            );
          })}
        </div>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="mt-2 w-full rounded px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t('type.clear')}
          </button>
        )}
      </div>
    </details>
  );
}
