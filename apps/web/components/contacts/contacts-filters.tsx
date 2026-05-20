'use client';

import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import type { ContactTemperature } from '@eclick-active/shared';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTemperatureStyles } from './temperature-badge';
import { cn } from '@/lib/utils';

interface ContactsFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  temperature: ContactTemperature | null;
  onTemperatureChange: (value: ContactTemperature | null) => void;
}

const TEMPERATURES: ContactTemperature[] = ['cold', 'warm', 'hot', 'very_hot'];

export function ContactsFilters({
  search,
  onSearchChange,
  temperature,
  onTemperatureChange,
}: ContactsFiltersProps) {
  const tFilters = useTranslations('contacts.filters');
  const styles = useTemperatureStyles();
  return (
    <div className="flex flex-col gap-3 border-b border-border px-8 py-4 sm:flex-row sm:items-center">
      <div className="relative flex-1 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={tFilters('searchPlaceholder')}
          className="pl-9 pr-9"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            aria-label={tFilters('clearSearch')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant={temperature === null ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => onTemperatureChange(null)}
        >
          {tFilters('all')}
        </Button>
        {TEMPERATURES.map((t) => {
          const active = temperature === t;
          const style = styles[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => onTemperatureChange(active ? null : t)}
              className={cn(
                'inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors',
                active ? style.bg : 'hover:bg-muted',
                active ? style.text : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {style.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
