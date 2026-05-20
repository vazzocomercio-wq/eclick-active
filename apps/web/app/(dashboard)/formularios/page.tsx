'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Share2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formsApi } from '@/lib/api/forms';
import { ApiError } from '@/lib/api/client';
import type { Form } from '@eclick-active/shared';
import { TemplatesDialog } from '@/components/formularios/templates-dialog';
import { PublishDialog } from '@/components/formularios/publish-dialog';
import { useConfirm } from '@/components/ui/confirm-provider';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<Form['status'], string> = {
  draft: 'bg-muted text-muted-foreground',
  active: 'bg-green-500/15 text-green-500',
  paused: 'bg-yellow-500/15 text-yellow-500',
  archived: 'bg-muted text-muted-foreground',
};

export default function FormulariosPage() {
  const t = useTranslations('formularios.list');
  const router = useRouter();
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [publishing, setPublishing] = useState<Form | null>(null);
  const [creating, setCreating] = useState(false);
  const confirm = useConfirm();

  const reload = useCallback(async () => {
    setError(null);
    try {
      const list = await formsApi.list();
      setForms(list);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : t('errors.load'),
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function createBlank() {
    setCreating(true);
    setError(null);
    try {
      const form = await formsApi.create({
        name: t('untitled'),
        fields: [],
      });
      router.push(`/formularios/${form.id}/editar`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.createBlank'));
      setCreating(false);
    }
  }

  async function togglePublish(form: Form) {
    try {
      const updated =
        form.status === 'active'
          ? await formsApi.pause(form.id)
          : await formsApi.publish(form.id);
      setForms((curr) => curr.map((f) => (f.id === form.id ? updated : f)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.toggleStatus'));
    }
  }

  async function duplicate(form: Form) {
    try {
      const copy = await formsApi.duplicate(form.id);
      setForms((curr) => [copy, ...curr]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.duplicate'));
    }
  }

  async function remove(form: Form) {
    const ok = await confirm({
      title: t('deleteDialog.title', { name: form.name }),
      description: t('deleteDialog.description'),
      variant: 'destructive',
      confirmLabel: t('deleteDialog.confirm'),
      icon: Trash2,
    });
    if (!ok) return;
    try {
      await formsApi.remove(form.id);
      setForms((curr) => curr.filter((f) => f.id !== form.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.remove'));
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-semibold">{t('title')}</h1>
            {!loading && (
              <span className="text-xs text-muted-foreground">
                ·{' '}
                {forms.length === 1
                  ? t('countOne', { count: forms.length })
                  : t('countMany', { count: forms.length })}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTemplatesOpen(true)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('templates')}
          </Button>
          <Button size="sm" onClick={createBlank} disabled={creating}>
            {creating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {t('newForm')}
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : forms.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="text-base font-semibold">
              {t('emptyTitle')}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('emptyDescription')}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTemplatesOpen(true)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t('viewTemplates')}
              </Button>
              <Button size="sm" onClick={createBlank}>
                <Plus className="h-3.5 w-3.5" />
                {t('createBlank')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {forms.map((f) => (
              <div
                key={f.id}
                className="group flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/formularios/${f.id}/editar`}
                    className="flex-1 truncate text-sm font-semibold hover:text-primary"
                  >
                    {f.name}
                  </Link>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                      STATUS_STYLES[f.status],
                    )}
                  >
                    {t(`status.${f.status}`)}
                  </span>
                </div>
                {f.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {f.description}
                  </p>
                )}
                <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    <strong className="text-foreground">
                      {f.submissions_count}
                    </strong>{' '}
                    {t('submissions')}
                  </span>
                  <span>·</span>
                  <span title={f.updated_at}>
                    {formatRelativeTime(f.updated_at)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                  >
                    <Link href={`/formularios/${f.id}/editar`}>
                      <Pencil className="h-3 w-3" />
                      {t('edit')}
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => togglePublish(f)}
                  >
                    {f.status === 'active' ? (
                      <>
                        <Pause className="h-3 w-3" />
                        {t('pause')}
                      </>
                    ) : (
                      <>
                        <Play className="h-3 w-3" />
                        {t('publish')}
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setPublishing(f)}
                    disabled={f.status !== 'active'}
                    title={
                      f.status !== 'active'
                        ? t('publishFirstHint')
                        : t('shareTitle')
                    }
                  >
                    <Share2 className="h-3 w-3" />
                    {t('share')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => duplicate(f)}
                    title={t('duplicate')}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => remove(f)}
                    title={t('deleteTitle')}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                  {f.status === 'active' && (
                    <a
                      href={`/f/${f.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={t('openPublic')}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <TemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onCreated={(form) => {
          setTemplatesOpen(false);
          router.push(`/formularios/${form.id}/editar`);
        }}
      />

      {publishing && (
        <PublishDialog
          form={publishing}
          open={!!publishing}
          onOpenChange={(open) => !open && setPublishing(null)}
        />
      )}
    </div>
  );
}
