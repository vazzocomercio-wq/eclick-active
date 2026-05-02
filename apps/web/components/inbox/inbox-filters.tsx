'use client';

import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { InboxFilter } from '@/hooks/use-inbox';

interface InboxFiltersProps {
  filter: InboxFilter;
  onFilterChange: (f: InboxFilter) => void;
  search: string;
  onSearchChange: (q: string) => void;
}

const FILTERS: Array<{ value: InboxFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'mine', label: 'Minhas' },
  { value: 'unassigned', label: 'Não atribuídas' },
  { value: 'resolved', label: 'Resolvidas' },
  { value: 'archived', label: 'Arquivadas' },
];

export function InboxFilters({
  filter,
  onFilterChange,
  search,
  onSearchChange,
}: InboxFiltersProps) {
  return (
    <div className="flex flex-col gap-2 border-b border-border p-3">
      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar contato..."
          className="h-9 pl-8 pr-8 text-sm"
        />
        {search && (
          <button
            type="button"
            aria-label="Limpar busca"
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => onFilterChange(f.value)}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium transition-colors',
              filter === f.value
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
