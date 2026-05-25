'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Rocket,
  Loader2,
  ChevronRight,
  Sparkles,
  Wand2,
} from 'lucide-react';
import {
  socialApi,
  type SocialCampaign,
  type SocialCampaignRecipe,
  type CampaignStrategy,
} from '@/lib/api/social';
import { useBrands } from '@/hooks/use-social';
import { useStyleCatalog } from '@/lib/social/use-style-catalog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STRATEGIES: Array<[CampaignStrategy, string, string]> = [
  ['mixed', 'Equilibrado', 'mistura margem, overstock e demanda'],
  ['high_margin', 'Maior margem', 'produtos que dão mais lucro'],
  ['overstock', 'Girar estoque', 'produtos parados há mais tempo'],
  ['radar', 'Em alta (Radar)', 'produtos com demanda subindo no mercado'],
];

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
  const { brands } = useBrands();
  const { findStyle, findFramework } = useStyleCatalog();

  // Geração em lote
  const [recipe, setRecipe] = useState<SocialCampaignRecipe | null>(null);
  const [showBatch, setShowBatch] = useState(false);
  const [strategy, setStrategy] = useState<CampaignStrategy>('mixed');
  const [count, setCount] = useState(3);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);

  function reload() {
    socialApi.campaigns
      .list()
      .then(setCampaigns)
      .catch(() => {});
  }

  useEffect(() => {
    const ctrl = new AbortController();
    socialApi.campaigns
      .list(ctrl.signal)
      .then(setCampaigns)
      .catch(() => {})
      .finally(() => setLoading(false));
    socialApi.recipes
      .getDefault(ctrl.signal)
      .then(setRecipe)
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  async function handleBatch() {
    const brandId = brands[0]?.id;
    if (!brandId || batchBusy) return;
    setBatchBusy(true);
    setBatchMsg(null);
    try {
      const styleIds = recipe?.allowed_video_styles?.length
        ? recipe.allowed_video_styles
        : ['360', 'cinemagraph', 'hook_payoff', 'storytelling'];
      const fwIds = recipe?.allowed_frameworks?.length
        ? recipe.allowed_frameworks
        : ['dsb', 'aida', 'pas'];
      const video_styles = styleIds
        .map(findStyle)
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => ({ id: s.id, label: s.label, prompt: s.hint, camera: s.camera }));
      const frameworks = fwIds
        .map(findFramework)
        .filter((f): f is NonNullable<typeof f> => !!f)
        .map((f) => ({ id: f.id, label: f.label, prompt: f.hint }));
      const r = await socialApi.campaigns.generateBatch({
        brand_id: brandId,
        recipe_id: recipe?.id ?? null,
        strategy,
        count,
        video_styles,
        frameworks,
      });
      setBatchMsg(
        `${r.campaigns.length} campanha(s) iniciada(s)${r.skipped ? ` · ${r.skipped} pulada(s)` : ''}.`,
      );
      setShowBatch(false);
      reload();
    } catch (e) {
      setBatchMsg(e instanceof Error ? e.message : 'Falha na geração em lote');
    } finally {
      setBatchBusy(false);
    }
  }

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
        <Button variant="outline" size="sm" onClick={() => setShowBatch((v) => !v)}>
          <Wand2 className="mr-1 h-3.5 w-3.5" />
          Gerar em lote
        </Button>
        <Button size="sm" asChild>
          <Link href="/social/criar">
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Nova campanha
          </Link>
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {batchMsg && (
          <div className="mx-auto mb-3 max-w-3xl rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
            {batchMsg}
          </div>
        )}
        {showBatch && (
          <div className="mx-auto mb-4 max-w-3xl rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-transparent p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Wand2 className="h-4 w-4 text-primary" />
              Gerar campanhas em lote
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A IA escolhe os produtos por estratégia comercial e cria uma campanha
              pra cada — tudo na fila de aprovação.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Estratégia
                </span>
                <select
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value as CampaignStrategy)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                >
                  {STRATEGIES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {STRATEGIES.find((s) => s[0] === strategy)?.[2]}
                </span>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Quantos produtos
                </span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={count}
                  onChange={(e) =>
                    setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
                  }
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                onClick={handleBatch}
                disabled={batchBusy || !brands[0]}
              >
                {batchBusy ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="mr-1 h-3.5 w-3.5" />
                )}
                Gerar {count} campanha{count > 1 ? 's' : ''}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                consome créditos de IA (vídeo)
              </span>
            </div>
          </div>
        )}
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
