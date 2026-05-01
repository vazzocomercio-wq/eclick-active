'use client';

import type { TaskPriority, TaskStatus, TaskType } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

export type StatusFilter = TaskStatus | 'all' | 'overdue';

interface TaskFiltersProps {
  statusFilter: StatusFilter;
  priorityFilter: TaskPriority | null;
  typeFilter: TaskType | null;
  onlyMine: boolean;
  onChangeStatus: (s: StatusFilter) => void;
  onChangePriority: (p: TaskPriority | null) => void;
  onChangeType: (t: TaskType | null) => void;
  onChangeMine: (mine: boolean) => void;
}

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'overdue', label: 'Atrasadas' },
  { value: 'completed', label: 'Concluídas' },
];

const PRIORITY_OPTIONS: Array<{ value: TaskPriority | null; label: string }> = [
  { value: null, label: 'Todas' },
  { value: 'low', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
];

const TYPE_OPTIONS: Array<{ value: TaskType | null; label: string }> = [
  { value: null, label: 'Todos' },
  { value: 'call', label: 'Ligação' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Reunião' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'proposal', label: 'Proposta' },
  { value: 'custom', label: 'Personalizado' },
];

export function TaskFilters({
  statusFilter,
  priorityFilter,
  typeFilter,
  onlyMine,
  onChangeStatus,
  onChangePriority,
  onChangeType,
  onChangeMine,
}: TaskFiltersProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Status row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChangeStatus(o.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              statusFilter === o.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Secondary filters row */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Prioridade"
          value={priorityFilter}
          options={PRIORITY_OPTIONS}
          onChange={(v) => onChangePriority(v as TaskPriority | null)}
        />
        <FilterSelect
          label="Tipo"
          value={typeFilter}
          options={TYPE_OPTIONS}
          onChange={(v) => onChangeType(v as TaskType | null)}
        />

        <label className="ml-auto flex cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-xs">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(e) => onChangeMine(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input"
          />
          <span className="font-medium">Só minhas</span>
        </label>
      </div>
    </div>
  );
}

function FilterSelect<T extends string | null>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-md border border-input bg-card px-2.5 py-1 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || null) as T)}
        className="bg-transparent text-foreground focus:outline-none"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={o.value ?? ''}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
