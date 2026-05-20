'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Sparkles } from 'lucide-react';
import type { KnowledgeCategory } from '@eclick-active/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { knowledgeApi } from '@/lib/api/knowledge';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { KNOWLEDGE_CATEGORIES, useCategoryLabel } from './category-badge';
import { DOCUMENT_TEMPLATES, type DocumentTemplate } from './templates';

interface NewDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function NewDocumentDialog({ open, onOpenChange, onCreated }: NewDocumentDialogProps) {
  const t = useTranslations('conhecimento.newDocument');
  const categoryLabel = useCategoryLabel();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<KnowledgeCategory>('general');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setCategory('general');
      setContent('');
      setError(null);
    }
  }, [open]);

  const tokens = estimateTokens(content);

  function applyTemplate(t: DocumentTemplate) {
    setTitle(t.title);
    setCategory(t.category);
    setContent(t.content);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await knowledgeApi.create({
        title: title.trim(),
        category,
        content: content.trim(),
      });
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : t('createError'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          {/* Templates */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">{t('startFromTemplate')}</Label>
            <div className="flex flex-wrap gap-1.5">
              {DOCUMENT_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px]',
                    'transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary',
                  )}
                >
                  <Sparkles className="h-3 w-3" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>{t('titleLabel')} <span className="text-destructive">*</span></Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('titlePlaceholder')}
                required
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>{t('categoryLabel')}</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as KnowledgeCategory)}
                className={cn(
                  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              >
                {KNOWLEDGE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label>{t('contentLabel')} <span className="text-destructive">*</span></Label>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {t('tokens', { n: tokens })}
              </span>
            </div>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('contentPlaceholder')}
              rows={20}
              required
              className="font-mono text-xs leading-relaxed"
            />
          </div>

          {error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={submitting || !title.trim() || !content.trim()}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitting ? t('submitting') : t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Estimativa rápida: ~4 chars por token (mesma heurística do backend) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
