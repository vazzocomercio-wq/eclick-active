'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formsApi, type FormTemplateSummary } from '@/lib/api/forms';
import type { Form } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

const CATEGORY_EMOJI: Record<string, string> = {
  orcamento: '💼',
  agendamento: '📅',
  solar: '☀️',
  imobiliaria: '🏠',
  educacao: '🎓',
  b2b: '🏢',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (form: Form) => void;
}

export function TemplatesDialog({ open, onOpenChange, onCreated }: Props) {
  const t = useTranslations('formularios.templates');
  const [templates, setTemplates] = useState<FormTemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingCategory, setCreatingCategory] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let aborted = false;
    setLoading(true);
    setError(null);
    formsApi
      .templates()
      .then((list) => {
        if (!aborted) setTemplates(list);
      })
      .catch((err: unknown) => {
        if (!aborted) {
          setError(
            err instanceof Error ? err.message : t('errors.load'),
          );
        }
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [open]);

  async function useTemplate(tpl: FormTemplateSummary) {
    setCreatingCategory(tpl.category);
    setError(null);
    try {
      const form = await formsApi.create({
        name: tpl.name,
        description: tpl.description,
        fields: tpl.fields,
        settings: tpl.settings,
        branding: tpl.branding,
        template_category: tpl.category,
      });
      onCreated(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.create'));
      setCreatingCategory(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>
            {t('description')}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-h-[60vh] overflow-y-auto pr-1">
            {templates.map((tpl) => {
              const isCreating = creatingCategory === tpl.category;
              return (
                <button
                  key={tpl.category}
                  type="button"
                  onClick={() => useTemplate(tpl)}
                  disabled={creatingCategory !== null}
                  className={cn(
                    'group flex flex-col rounded-lg border border-border bg-background p-4 text-left transition-colors',
                    'hover:border-primary/50 hover:bg-card',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">
                      {CATEGORY_EMOJI[tpl.category] ?? '📝'}
                    </span>
                    <span className="text-sm font-semibold">{tpl.name}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {tpl.description}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {t('fieldsCount', { count: tpl.fields.length })}
                    </span>
                    {isCreating ? (
                      <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    ) : (
                      <span className="text-primary opacity-0 transition-opacity group-hover:opacity-100">
                        {t('useArrow')}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
