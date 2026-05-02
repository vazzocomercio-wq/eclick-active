'use client';

import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { TaskType } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  type CalendarViewMode,
  dayLabel,
  monthYearLabel,
  weekRangeLabel,
} from './calendar-utils';

const VIEW_OPTIONS: Array<{ value: CalendarViewMode; label: string }> = [
  { value: 'day', label: 'Dia' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
];

const TASK_TYPE_OPTIONS: Array<{ value: TaskType; label: string }> = [
  { value: 'call', label: 'Ligação' },
  { value: 'meeting', label: 'Reunião' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'proposal', label: 'Proposta' },
  { value: 'custom', label: 'Personalizado' },
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
  const periodLabel =
    view === 'month'
      ? monthYearLabel(current)
      : view === 'week'
        ? weekRangeLabel(current)
        : dayLabel(current);

  return (
    <header className="flex flex-col gap-3 border-b border-border bg-background px-4 py-3 md:px-6">
      {/* Linha 1 — título + nav + ações */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <h1 className="text-base font-semibold md:text-lg">Calendário</h1>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={onPrev}
            aria-label="Período anterior"
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
            aria-label="Próximo período"
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
            Hoje
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* View toggle — escondido em mobile (só Dia disponível) */}
          <div className="hidden items-center rounded-md border border-input bg-card p-0.5 md:inline-flex">
            {VIEW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChangeView(opt.value)}
                className={cn(
                  'rounded px-3 py-1 text-xs font-medium transition-colors',
                  view === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <Button size="sm" onClick={onNewTask}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Nova tarefa
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
          <span className="font-medium">Só minhas</span>
        </label>

        <TypeMultiSelect
          selected={selectedTypes}
          onToggle={onToggleType}
          onClear={onClearTypes}
        />

        {loading && (
          <span className="ml-auto text-xs text-muted-foreground">
            Carregando…
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
  const label =
    selected.length === 0
      ? 'Todos os tipos'
      : selected.length === 1
        ? `${TASK_TYPE_OPTIONS.find((o) => o.value === selected[0])?.label}`
        : `${selected.length} tipos`;

  return (
    <details className="relative">
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-xs',
          'marker:hidden [&::-webkit-details-marker]:hidden',
        )}
      >
        <span className="text-muted-foreground">Tipo:</span>
        <span className="font-medium">{label}</span>
      </summary>
      <div className="absolute z-20 mt-1 w-56 rounded-md border border-border bg-popover p-2 shadow-lg">
        <div className="flex flex-col gap-1">
          {TASK_TYPE_OPTIONS.map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(opt.value)}
                  className="h-3.5 w-3.5 rounded border-input"
                />
                <span>{opt.label}</span>
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
            Limpar filtro
          </button>
        )}
      </div>
    </details>
  );
}
