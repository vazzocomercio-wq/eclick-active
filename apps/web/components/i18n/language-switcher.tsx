'use client';

/**
 * Seletor de idioma — vive no rodapé da sidebar, ao lado do ThemeToggle.
 * Grava o idioma num cookie via server action e atualiza a árvore de
 * server components. Suporta modo `collapsed` (só ícone).
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Languages, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { setLocale } from '@/i18n/locale-actions';
import { locales, localeFlags, localeNames, type Locale } from '@/i18n/locales';

interface LanguageSwitcherProps {
  collapsed?: boolean;
}

export function LanguageSwitcher({ collapsed = false }: LanguageSwitcherProps) {
  const current = useLocale() as Locale;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(loc: Locale) {
    setOpen(false);
    if (loc === current) return;
    startTransition(async () => {
      await setLocale(loc);
      router.refresh();
    });
  }

  const menu = open && (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      <div
        className={cn(
          'absolute bottom-full z-50 mb-1 w-44 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg',
          collapsed ? 'left-0' : 'left-0 right-0',
        )}
      >
        {locales.map((loc) => (
          <button
            key={loc}
            type="button"
            onClick={() => choose(loc)}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
              'hover:bg-card',
              loc === current ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <span className="text-base leading-none">{localeFlags[loc]}</span>
            <span className="flex-1 text-left">{localeNames[loc]}</span>
            {loc === current && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        ))}
      </div>
    </>
  );

  if (collapsed) {
    return (
      <div className="relative">
        {menu}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={pending}
          title="Idioma / Language"
          aria-label="Idioma / Language"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-50"
        >
          <Languages className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {menu}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-label="Idioma / Language"
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm',
          'text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-50',
        )}
      >
        <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left">{localeNames[current]}</span>
        <span className="text-base leading-none">{localeFlags[current]}</span>
      </button>
    </div>
  );
}
