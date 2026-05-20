'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('tarefas.filters');

  const STATUS_OPTIONS = useMemo<Array<{ value: StatusFilter; label: string }>>(
    () => [
      { value: 'all', label: t('status.all') },
      { value: 'pending', label: t('status.pending') },
      { value: 'in_progress', label: t('status.in_progress') },
      { value: 'overdue', label: t('status.overdue') },
      { value: 'completed', label: t('status.completed') },
    ],
    [t],
  );

  const PRIORITY_OPTIONS = useMemo<Array<{ value: TaskPriority | null; label: string }>>(
    () => [
      { value: null, label: t('priority.all') },
      { value: 'low', label: t('priority.low') },
      { value: 'normal', label: t('priority.normal') },
      { value: 'high', label: t('priority.high') },
      { value: 'urgent', label: t('priority.urgent') },
    ],
    [t],
  );

  const TYPE_OPTIONS = useMemo<Array<{ value: TaskType | null; label: string }>>(
    () => [
      { value: null, label: t('type.all') },
      { value: 'call', label: t('type.call') },
      { value: 'email', label: t('type.email') },
      { value: 'meeting', label: t('type.meeting') },
      { value: 'follow_up', label: t('type.follow_up') },
      { value: 'whatsapp', label: t('type.whatsapp') },
      { value: 'proposal', label: t('type.proposal') },
      { value: 'custom', label: t('type.custom') },
    ],
    [t],
  );

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
          label={t('priority.label')}
          value={priorityFilter}
          options={PRIORITY_OPTIONS}
          onChange={(v) => onChangePriority(v as TaskPriority | null)}
        />
        <FilterSelect
          label={t('type.label')}
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
          <span className="font-medium">{t('onlyMine')}</span>
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
