'use client';

import { useTranslations } from 'next-intl';
import type { LucideIcon } from 'lucide-react';

interface PlaceholderPageProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

/** Placeholder reutilizado por todas as 11 rotas do dashboard até cada feature ser implementada. */
export function PlaceholderPage({ title, subtitle, icon: Icon }: PlaceholderPageProps) {
  const t = useTranslations('placeholder');
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-col gap-1 border-b border-border px-8 py-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-16 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-border bg-card">
          <Icon className="h-12 w-12 text-primary" aria-hidden="true" />
        </div>
        <p className="text-lg font-medium text-foreground">{t('inDevelopment')}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {t.rich('description', {
            title,
            highlight: (chunks) => (
              <span className="font-medium text-foreground">{chunks}</span>
            ),
          })}
        </p>
      </div>
    </div>
  );
}
