'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Rocket,
  Loader2,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { socialApi, type SocialCampaign } from '@/lib/api/social';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<SocialCampaign['status'], string> = {
  generating: 'Gerando…',
  ready_for_review: 'Pronto pra revisar',
  scheduled: 'Agendado',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

const STATUS_CLS: Record<SocialCampaign['status'], string> = {
  generating: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  ready_for_review: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  scheduled: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-300',
  cancelled: 'bg-muted text-muted-foreground',
};

export default function CampanhasPage() {
  const [campaigns, setCampaigns] = useState<SocialCampaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    socialApi.campaigns
      .list(ctrl.signal)
      .then(setCampaigns)
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-border bg-background px-4 py-3 md:px-6">
        <Link href="/social" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Rocket className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <h1 className="text-lg font-semibold leading-tight">Campanhas</h1>
          <p className="text-xs text-muted-foreground">
            Pacotes de conteúdo gerados pela IA a partir de um produto.
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href="/social/criar">
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Nova campanha
          </Link>
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="mx-auto max-w-md rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <Rocket className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Nenhuma campanha ainda</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Escolha um produto em “Criar conteúdo” e clique em{' '}
              <strong>Gerar campanha completa</strong> — a IA cria reels, posts e
              carrosséis de uma vez.
            </p>
            <Button size="sm" className="mt-4" asChild>
              <Link href="/social/criar">
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                Criar a primeira
              </Link>
            </Button>
          </div>
        ) : (
          <div className="mx-auto grid max-w-3xl gap-2">
            {campaigns.map((c) => {
              const counts = c.planned_counts ?? {};
              return (
                <Link
                  key={c.id}
                  href={`/social/campanhas/${c.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition hover:border-primary/40"
                >
                  {c.product_image_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={c.product_image_url}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Rocket className="h-5 w-5 text-muted-foreground" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {counts.reels ?? 0} reels · {counts.carousels ?? 0} carrosséis ·{' '}
                      {counts.posts ?? 0} posts
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      STATUS_CLS[c.status],
                    )}
                  >
                    {c.status === 'generating' && (
                      <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                    )}
                    {STATUS_LABEL[c.status]}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
