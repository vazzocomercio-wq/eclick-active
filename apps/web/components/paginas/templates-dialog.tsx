'use client';

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PAGE_TEMPLATES, TEMPLATE_CATEGORIES, type PageTemplate } from './templates';
import { pagesApi } from '@/lib/api/pages';
import type { Page } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (page: Page) => void;
}

export function TemplatesDialog({ open, onOpenChange, onCreated }: Props) {
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function useTemplate(t: PageTemplate) {
    setCreatingId(t.id);
    setError(null);
    try {
      const page = await pagesApi.generate({
        description: t.ai_prompt,
        page_type: t.page_type,
        use_catalog_products: t.use_catalog_products ?? false,
        include_form: t.include_form ?? false,
        include_whatsapp: t.include_whatsapp ?? false,
      });
      onCreated(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar template');
      setCreatingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !creatingId && onOpenChange(o)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Templates prontos
          </DialogTitle>
          <DialogDescription>
            Cada template gera uma página completa com IA — você pode editar tudo depois.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="max-h-[65vh] overflow-y-auto pr-1 scrollbar-thin">
          {TEMPLATE_CATEGORIES.map((cat) => {
            const items = PAGE_TEMPLATES.filter((t) => t.category === cat);
            return (
              <div key={cat} className="mb-6">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {cat}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {items.map((t) => {
                    const busy = creatingId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => useTemplate(t)}
                        disabled={creatingId !== null}
                        className={cn(
                          'group flex flex-col rounded-lg border border-border bg-background p-4 text-left transition-colors',
                          'hover:border-primary/50 hover:bg-card',
                          'disabled:cursor-not-allowed disabled:opacity-60',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{t.emoji}</span>
                          <span className="text-sm font-semibold">{t.name}</span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                          {t.description}
                        </p>
                        <div className="mt-3 flex items-center justify-between text-xs">
                          <span className="text-muted-foreground capitalize">
                            {t.page_type.replace('_', ' ')}
                          </span>
                          {busy ? (
                            <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          ) : (
                            <span className="text-primary opacity-0 transition-opacity group-hover:opacity-100">
                              Gerar →
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
