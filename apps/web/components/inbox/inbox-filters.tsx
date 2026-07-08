'use client';

import { Search, Star, X, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { InboxFilter } from '@/hooks/use-inbox';

interface InboxFiltersProps {
  filter: InboxFilter;
  onFilterChange: (f: InboxFilter) => void;
  search: string;
  onSearchChange: (q: string) => void;
}

export function InboxFilters({
  filter,
  onFilterChange,
  search,
  onSearchChange,
}: InboxFiltersProps) {
  const t = useTranslations('inbox.filters');

  const FILTERS: Array<{ value: InboxFilter; label: string; icon?: LucideIcon }> = [
    { value: 'all', label: t('all') },
    { value: 'mine', label: t('mine') },
    { value: 'unassigned', label: t('unassigned') },
    { value: 'starred', label: t('starred'), icon: Star },
    { value: 'resolved', label: t('resolved') },
    { value: 'archived', label: t('archived') },
  ];

  return (
    <div className="flex flex-col gap-2 border-b border-border p-3">
      {/* Busca por nome / telefone / e-mail do contato. */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="h-9 pl-8 pr-8 text-sm"
        />
        {search && (
          <button
            type="button"
            aria-label={t('clearSearchAria')}
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => {
          const Icon = f.icon;
          const active = filter === f.value;
          const isStar = f.value === 'starred';
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => onFilterChange(f.value)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                active
                  ? isStar
                    ? 'bg-yellow-400/15 text-yellow-500'
                    : 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {Icon && (
                <Icon
                  className="h-3 w-3"
                  fill={active && isStar ? 'currentColor' : 'none'}
                  strokeWidth={active && isStar ? 0 : 2}
                />
              )}
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
