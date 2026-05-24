'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Rocket,
  Loader2,
  Check,
  X,
  CalendarClock,
  Film,
  Images,
  Image as ImageIcon,
  AlertTriangle,
  ExternalLink,
  Megaphone,
} from 'lucide-react';
import {
  socialApi,
  type CampaignDetail,
  type SocialCampaignAsset,
  type SocialContent,
} from '@/lib/api/social';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ASSET_ICON = { reel: Film, carousel: Images, post: ImageIcon };
const ASSET_LABEL = { reel: 'Reel', carousel: 'Carrossel', post: 'Post' };

const ASSET_STATUS_LABEL: Record<SocialCampaignAsset['status'], string> = {
  pending: 'Na fila',
  generating: 'Gerando…',
  ready: 'Pronto',
  failed: 'Falhou',
  approved: 'Aprovado',
  scheduled: 'Agendado',
  published: 'Publicado',
};

const ASSET_STATUS_CLS: Record<SocialCampaignAsset['status'], string> = {
  pending: 'bg-muted text-muted-foreground',
  generating: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  ready: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-300',
  approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  scheduled: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  published: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;

  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adsBusy, setAdsBusy] = useState(false);
  const [adsMsg, setAdsMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const d = await socialApi.campaigns.get(id, signal);
        setDetail(d);
        return d;
      } catch (e) {
        if (!signal?.aborted) {
          setError(e instanceof Error ? e.message : 'Erro ao carregar a campanha');
        }
        return null;
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  // Carrega + faz polling enquanto estiver gerando
  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    let active = true;

    const tick = async () => {
      const d = await load(ctrl.signal);
      if (!active) return;
      if (d && d.campaign.status === 'generating') {
        pollRef.current = setTimeout(tick, 5000);
      }
    };
    tick();

    return () => {
      active = false;
      ctrl.abort();
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [id, load]);

  async function approveAll() {
    setBusy(true);
    setError(null);
    try {
      const d = await socialApi.campaigns.approve(id);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao aprovar');
    } finally {
      setBusy(false);
    }
  }

  async function createAds() {
    setAdsBusy(true);
    setAdsMsg(null);
    try {
      const r = await socialApi.campaigns.createAds(id);
      setAdsMsg(
        r.created > 0
          ? `${r.created} rascunho(s) de anúncio criados — veja em Ad Boost.`
          : 'Nenhuma peça elegível pra anúncio ainda.',
      );
    } catch (e) {
      setAdsMsg(e instanceof Error ? e.message : 'Erro ao criar anúncios');
    } finally {
      setAdsBusy(false);
    }
  }

  async function cancelCampaign() {
    setBusy(true);
    try {
      await socialApi.campaigns.cancel(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao cancelar');
    } finally {
      setBusy(false);
    }
  }

  const campaign = detail?.campaign;
  const assets = detail?.assets ?? [];
  const contentsById = new Map<string, SocialContent>(
    (detail?.contents ?? []).map((c) => [c.id, c]),
  );

  const readyCount = assets.filter((a) => a.status === 'ready').length;
  const canApprove = campaign?.status === 'ready_for_review' && readyCount > 0;
  const isGenerating = campaign?.status === 'generating';
  const hasContent = assets.some((a) =>
    ['ready', 'scheduled', 'approved', 'published'].includes(a.status),
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-border bg-background px-4 py-3 md:px-6">
        <Link
          href="/social/campanhas"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Rocket className="h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold leading-tight">
            {campaign?.name ?? 'Campanha'}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isGenerating
              ? 'A IA está criando as peças — isso leva alguns minutos.'
              : campaign?.status === 'scheduled'
                ? 'Peças aprovadas e agendadas.'
                : 'Revise e aprove as peças.'}
          </p>
        </div>
        {campaign && campaign.status !== 'cancelled' && (
          <div className="flex items-center gap-2">
            {(isGenerating || canApprove) && (
              <Button
                variant="outline"
                size="sm"
                onClick={cancelCampaign}
                disabled={busy}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Cancelar
              </Button>
            )}
            {hasContent && (
              <Button
                variant="outline"
                size="sm"
                onClick={createAds}
                disabled={adsBusy}
                title="Cria rascunhos de anúncio (Meta) pras peças prontas"
              >
                {adsBusy ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Megaphone className="mr-1 h-3.5 w-3.5" />
                )}
                Gerar anúncios
              </Button>
            )}
            {canApprove && (
              <Button size="sm" onClick={approveAll} disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CalendarClock className="mr-1 h-3.5 w-3.5" />
                )}
                Aprovar tudo e agendar ({readyCount})
              </Button>
            )}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !campaign ? (
          <p className="text-center text-sm text-muted-foreground">
            Campanha não encontrada.
          </p>
        ) : (
          <div className="mx-auto max-w-4xl">
            {error && (
              <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600">
                {error}
              </div>
            )}
            {adsMsg && (
              <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                {adsMsg}
              </div>
            )}

            {/* Resumo */}
            <div className="mb-5 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4">
              {campaign.product_image_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={campaign.product_image_url}
                  alt=""
                  className="h-14 w-14 rounded-md object-cover"
                />
              )}
              <div className="flex flex-1 flex-wrap gap-x-6 gap-y-1 text-sm">
                <Stat label="Peças" value={String(assets.length)} />
                <Stat label="Prontas" value={String(readyCount)} />
                <Stat
                  label="Custo estimado"
                  value={
                    campaign.estimated_cost_usd != null
                      ? `US$ ${campaign.estimated_cost_usd}`
                      : '—'
                  }
                />
                <Stat
                  label="Autonomia"
                  value={
                    campaign.autonomy_level === 'approval'
                      ? 'Aprovação'
                      : campaign.autonomy_level === 'draft'
                        ? 'Rascunho'
                        : 'Piloto automático'
                  }
                />
              </div>
            </div>

            {campaign.status === 'scheduled' && (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                <Check className="h-4 w-4" />
                Tudo aprovado e agendado. Acompanhe em{' '}
                <Link href="/social/calendario" className="underline">
                  Calendário
                </Link>
                .
              </div>
            )}

            {/* Peças */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {assets.map((a) => {
                const content = a.content_id
                  ? contentsById.get(a.content_id)
                  : undefined;
                const Icon = ASSET_ICON[a.asset_type];
                const media = content?.media?.[0];
                const isVideo = a.asset_type === 'reel' && media?.url;
                return (
                  <div
                    key={a.id}
                    className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
                  >
                    <div className="relative aspect-[4/5] bg-muted">
                      {isVideo ? (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <video
                          src={media!.url}
                          poster={media!.thumbnail_url ?? undefined}
                          controls
                          className="h-full w-full object-cover"
                        />
                      ) : media?.url || content?.cover_image_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={media?.url ?? content?.cover_image_url ?? ''}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                          {a.status === 'generating' ? (
                            <>
                              <Loader2 className="h-6 w-6 animate-spin" />
                              <span className="text-[11px]">gerando…</span>
                            </>
                          ) : a.status === 'failed' ? (
                            <>
                              <AlertTriangle className="h-6 w-6 text-red-500" />
                              <span className="px-3 text-center text-[11px]">
                                {a.error_message ?? 'falhou'}
                              </span>
                            </>
                          ) : (
                            <Icon className="h-6 w-6" />
                          )}
                        </div>
                      )}
                      <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
                        <Icon className="h-3 w-3" />
                        {ASSET_LABEL[a.asset_type]}
                      </span>
                      <span
                        className={cn(
                          'absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-medium',
                          ASSET_STATUS_CLS[a.status],
                        )}
                      >
                        {ASSET_STATUS_LABEL[a.status]}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      {a.angle && (
                        <p className="text-xs font-medium">{a.angle}</p>
                      )}
                      {content?.caption && (
                        <p className="line-clamp-3 text-[11px] text-muted-foreground">
                          {content.caption}
                        </p>
                      )}
                      <div className="mt-auto flex items-center justify-between pt-1">
                        {a.scheduled_for ? (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <CalendarClock className="h-3 w-3" />
                            {fmtDate(a.scheduled_for)}
                          </span>
                        ) : (
                          <span />
                        )}
                        {content && (
                          <Link
                            href={`/social/conteudo/${content.id}`}
                            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                          >
                            Editar <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}
