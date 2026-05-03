'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Copy,
  ExternalLink,
  Layout,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Share2,
  ShoppingBag,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { pagesApi } from '@/lib/api/pages';
import { ApiError } from '@/lib/api/client';
import type { Page } from '@eclick-active/shared';
import { AiGenerateDialog } from '@/components/paginas/ai-generate-dialog';
import { TemplatesDialog } from '@/components/paginas/templates-dialog';
import { PublishDialog } from '@/components/paginas/publish-dialog';
import { useConfirm } from '@/components/ui/confirm-provider';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<Page['status'], string> = {
  draft: 'Rascunho',
  published: 'Publicada',
  paused: 'Pausada',
  archived: 'Arquivada',
};

const STATUS_STYLES: Record<Page['status'], string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-green-500/15 text-green-500',
  paused: 'bg-yellow-500/15 text-yellow-500',
  archived: 'bg-muted text-muted-foreground',
};

const TYPE_BADGE: Record<Page['page_type'], { label: string; emoji: string; color: string }> = {
  landing: { label: 'Landing', emoji: '🎯', color: 'text-cyan-400 bg-cyan-500/10' },
  store: { label: 'Loja', emoji: '🛍️', color: 'text-green-400 bg-green-500/10' },
  booking: { label: 'Agendamento', emoji: '📅', color: 'text-purple-400 bg-purple-500/10' },
  link_in_bio: { label: 'Bio', emoji: '🔗', color: 'text-pink-400 bg-pink-500/10' },
  sales_page: { label: 'Vendas', emoji: '💼', color: 'text-orange-400 bg-orange-500/10' },
  thank_you: { label: 'Obrigado', emoji: '✨', color: 'text-yellow-400 bg-yellow-500/10' },
};

export default function PaginasPage() {
  const router = useRouter();
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [publishingPage, setPublishingPage] = useState<Page | null>(null);
  const [creating, setCreating] = useState(false);
  const confirm = useConfirm();

  const reload = useCallback(async () => {
    setError(null);
    try {
      const list = await pagesApi.list();
      setPages(list);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar páginas',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function createBlank() {
    setCreating(true);
    setError(null);
    try {
      const page = await pagesApi.create({ name: 'Nova página', page_type: 'landing' });
      router.push(`/paginas/${page.id}/editar`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar');
      setCreating(false);
    }
  }

  async function togglePublish(page: Page) {
    try {
      const updated =
        page.status === 'published' ? await pagesApi.unpublish(page.id) : await pagesApi.publish(page.id);
      setPages((curr) => curr.map((p) => (p.id === page.id ? updated : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao publicar');
    }
  }

  async function duplicate(page: Page) {
    try {
      const copy = await pagesApi.duplicate(page.id);
      setPages((curr) => [copy, ...curr]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao duplicar');
    }
  }

  async function remove(page: Page) {
    const ok = await confirm({
      title: `Excluir "${page.name}"?`,
      description: 'A página vai pra lixeira (status archived). Pode ser restaurada via banco.',
      variant: 'destructive',
      confirmLabel: 'Excluir',
      icon: Trash2,
    });
    if (!ok) return;
    try {
      await pagesApi.remove(page.id);
      setPages((curr) => curr.filter((p) => p.id !== page.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir');
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Layout className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-semibold">Páginas & Lojas</h1>
            {!loading && (
              <span className="text-xs text-muted-foreground">
                · {pages.length} {pages.length === 1 ? 'página' : 'páginas'}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Crie landing pages e lojas com IA. Cada página é publicada num link único e conecta com seu CRM.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setTemplatesOpen(true)}>
            <Sparkles className="h-3.5 w-3.5" />
            Templates
          </Button>
          <Button variant="outline" size="sm" onClick={createBlank} disabled={creating}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Em branco
          </Button>
          <Button
            size="sm"
            className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:opacity-90"
            onClick={() => setAiOpen(true)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Criar com IA
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : pages.length === 0 ? (
          <EmptyState onAi={() => setAiOpen(true)} onTemplates={() => setTemplatesOpen(true)} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pages.map((p) => {
              const typeBadge = TYPE_BADGE[p.page_type];
              return (
                <div
                  key={p.id}
                  className="group flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50"
                >
                  {/* Thumbnail / preview placeholder */}
                  <div
                    className="mb-3 flex aspect-video items-center justify-center rounded-md"
                    style={{
                      background: `linear-gradient(135deg, ${p.global_styles.primary_color ?? '#00E5FF'}22, ${p.global_styles.secondary_color ?? '#0EA5E9'}22)`,
                    }}
                  >
                    <span className="text-4xl">{typeBadge.emoji}</span>
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/paginas/${p.id}/editar`}
                      className="flex-1 truncate text-sm font-semibold hover:text-primary"
                    >
                      {p.name}
                    </Link>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                        STATUS_STYLES[p.status],
                      )}
                    >
                      {STATUS_LABELS[p.status]}
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                        typeBadge.color,
                      )}
                    >
                      {typeBadge.label}
                    </span>
                    {p.ai_generated && (
                      <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        <Sparkles className="h-2.5 w-2.5" />
                        AI
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      <strong className="text-foreground">{p.visits_count}</strong> visitas
                    </span>
                    {p.page_type === 'store' && (
                      <>
                        <span>·</span>
                        <span>
                          <strong className="text-foreground">{p.orders_count}</strong> pedidos
                        </span>
                      </>
                    )}
                    <span>·</span>
                    <span title={p.updated_at}>{formatRelativeTime(p.updated_at)}</span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                    <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                      <Link href={`/paginas/${p.id}/editar`}>
                        <Pencil className="h-3 w-3" />
                        Editar
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => togglePublish(p)}
                    >
                      {p.status === 'published' ? (
                        <>
                          <Pause className="h-3 w-3" />
                          Pausar
                        </>
                      ) : (
                        <>
                          <Play className="h-3 w-3" />
                          Publicar
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setPublishingPage(p)}
                      disabled={p.status !== 'published'}
                      title={p.status !== 'published' ? 'Publique primeiro' : 'Compartilhar'}
                    >
                      <Share2 className="h-3 w-3" />
                    </Button>
                    {p.page_type === 'store' && (
                      <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                        <Link href={`/paginas/${p.id}/editar?tab=store`}>
                          <ShoppingBag className="h-3 w-3" />
                          Pedidos
                        </Link>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => duplicate(p)}
                      title="Duplicar"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => remove(p)}
                      title="Excluir"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                    {p.status === 'published' && (
                      <a
                        href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/p/${p.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Abrir página pública"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AiGenerateDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        onCreated={(p) => {
          setAiOpen(false);
          router.push(`/paginas/${p.id}/editar`);
        }}
      />

      <TemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onCreated={(p) => {
          setTemplatesOpen(false);
          router.push(`/paginas/${p.id}/editar`);
        }}
      />

      {publishingPage && (
        <PublishDialog
          page={publishingPage}
          open={!!publishingPage}
          onOpenChange={(open) => !open && setPublishingPage(null)}
        />
      )}
    </div>
  );
}

function EmptyState({ onAi, onTemplates }: { onAi: () => void; onTemplates: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-12 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20">
        <Sparkles className="h-7 w-7 text-primary" />
      </div>
      <h3 className="text-base font-semibold">Crie páginas profissionais com IA</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Descreva sua página em português e o Claude gera tudo: design, copy, blocos, SEO, formulários integrados.
        Edite no builder visual depois.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Button variant="outline" size="sm" onClick={onTemplates}>
          <Sparkles className="h-3.5 w-3.5" />
          Ver templates prontos
        </Button>
        <Button
          size="sm"
          className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:opacity-90"
          onClick={onAi}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Criar com IA agora
        </Button>
      </div>
    </div>
  );
}
