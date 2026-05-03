'use client';

import { useEffect, useState } from 'react';
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
            err instanceof Error ? err.message : 'Erro ao carregar templates',
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

  async function useTemplate(t: FormTemplateSummary) {
    setCreatingCategory(t.category);
    setError(null);
    try {
      const form = await formsApi.create({
        name: t.name,
        description: t.description,
        fields: t.fields,
        settings: t.settings,
        branding: t.branding,
        template_category: t.category,
      });
      onCreated(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar formulário');
      setCreatingCategory(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Templates de formulário
          </DialogTitle>
          <DialogDescription>
            Comece com um template pronto. Você pode editar tudo depois.
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
            {templates.map((t) => {
              const isCreating = creatingCategory === t.category;
              return (
                <button
                  key={t.category}
                  type="button"
                  onClick={() => useTemplate(t)}
                  disabled={creatingCategory !== null}
                  className={cn(
                    'group flex flex-col rounded-lg border border-border bg-background p-4 text-left transition-colors',
                    'hover:border-primary/50 hover:bg-card',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">
                      {CATEGORY_EMOJI[t.category] ?? '📝'}
                    </span>
                    <span className="text-sm font-semibold">{t.name}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t.description}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {t.fields.length} campos
                    </span>
                    {isCreating ? (
                      <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    ) : (
                      <span className="text-primary opacity-0 transition-opacity group-hover:opacity-100">
                        Usar →
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
