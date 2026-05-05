'use client';

import {
  Calendar,
  CalendarClock,
  CreditCard,
  FileText,
  HelpCircle,
  Search,
  Star,
  Stethoscope,
  Syringe,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  AnimatedPromptSuggestions,
  type PromptSuggestion,
} from '@/components/ui/animated-prompt-suggestions';
import { cn } from '@/lib/utils';
import type { InboxFilter } from '@/hooks/use-inbox';

/** Sugestões de busca textual fluindo embaixo quando search está vazio.
 *  Click preenche o input. Termos comuns que aparecem em conversas. */
const SEARCH_SUGGESTIONS: PromptSuggestion[] = [
  { text: 'agendamento', icon: CalendarClock, accent: '#00E5FF' },
  { text: 'consulta', icon: Stethoscope, accent: '#67e8f9' },
  { text: 'infusão', icon: Syringe, accent: '#a78bfa' },
  { text: 'particular', icon: CreditCard, accent: '#34d399' },
  { text: 'convênio', icon: CreditCard, accent: '#fcd34d' },
  { text: 'documento', icon: FileText, accent: '#f472b6' },
  { text: 'urgente', icon: HelpCircle, accent: '#ef4444' },
  { text: 'hoje', icon: Calendar, accent: '#fde68a' },
];

interface InboxFiltersProps {
  filter: InboxFilter;
  onFilterChange: (f: InboxFilter) => void;
  search: string;
  onSearchChange: (q: string) => void;
}

const FILTERS: Array<{ value: InboxFilter; label: string; icon?: LucideIcon }> = [
  { value: 'all', label: 'Todas' },
  { value: 'mine', label: 'Minhas' },
  { value: 'unassigned', label: 'Não atribuídas' },
  { value: 'starred', label: 'Favoritas', icon: Star },
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
      {/* Search com sugestões animadas embaixo quando vazio */}
      {!search ? (
        <AnimatedPromptSuggestions
          suggestions={SEARCH_SUGGESTIONS}
          onSuggestionClick={(text) => onSearchChange(text)}
          rows={1}
          compact
          speed={35}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar contato..."
              className="h-9 pl-8 pr-8 text-sm"
            />
          </div>
        </AnimatedPromptSuggestions>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar contato..."
            className="h-9 pl-8 pr-8 text-sm"
          />
          <button
            type="button"
            aria-label="Limpar busca"
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

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
                  fill={active && isStar ? '#FFC107' : 'none'}
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
