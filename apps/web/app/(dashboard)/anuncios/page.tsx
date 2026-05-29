'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Megaphone, Sparkles, Loader2, Play, Pause, Trash2, Rocket,
  CheckCircle2, AlertTriangle, ExternalLink, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  adsApi,
  type AdComposition,
  type AdIntegration,
  type AdObjective,
  type MetaPage,
} from '@/lib/api/ads';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const OBJECTIVES: { value: AdObjective; label: string }[] = [
  { value: 'conversions', label: 'Conversões / Vendas' },
  { value: 'traffic', label: 'Tráfego (cliques no site)' },
  { value: 'engagement', label: 'Engajamento' },
  { value: 'awareness', label: 'Reconhecimento' },
  { value: 'leads', label: 'Cadastros (leads)' },
];

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Rascunho', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  ready: { label: 'Pronto', cls: 'bg-blue-50 text-blue-600 border-blue-200' },
  publishing: { label: 'Publicando…', cls: 'bg-amber-50 text-amber-600 border-amber-200' },
  published: { label: 'Publicado (pausado no Meta)', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  failed: { label: 'Falhou', cls: 'bg-red-50 text-red-600 border-red-200' },
  paused: { label: 'Pausado', cls: 'bg-orange-50 text-orange-600 border-orange-200' },
  archived: { label: 'Arquivado', cls: 'bg-slate-50 text-slate-400 border-slate-200' },
};

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', s.cls)}>
      {s.label}
    </span>
  );
}

export default function AnunciosPage() {
  const [integrations, setIntegrations] = useState<AdIntegration[]>([]);
  const [comps, setComps] = useState<AdComposition[]>([]);
  const [pages, setPages] = useState<MetaPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // seleção de conta + página
  const [integrationId, setIntegrationId] = useState('');
  const [pageId, setPageId] = useState('');
  const [pagesLoading, setPagesLoading] = useState(false);

  // form IA
  const [prodName, setProdName] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodPrice, setProdPrice] = useState('');
  const [prodImage, setProdImage] = useState('');
  const [destUrl, setDestUrl] = useState('');
  const [objective, setObjective] = useState<AdObjective>('conversions');
  const [generating, setGenerating] = useState(false);

  // ações
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmPublishId, setConfirmPublishId] = useState<string | null>(null);

  const metaIntegrations = useMemo(
    () => integrations.filter((i) => i.platform === 'meta' && i.status === 'active'),
    [integrations],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ints, list] = await Promise.all([
        adsApi.listIntegrations(),
        adsApi.list(),
      ]);
      setIntegrations(ints);
      setComps(list.filter((c) => c.status !== 'archived'));
      const firstMeta = ints.find((i) => i.platform === 'meta' && i.status === 'active');
      if (firstMeta && !integrationId) setIntegrationId(firstMeta.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar.');
    } finally {
      setLoading(false);
    }
  }, [integrationId]);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // carrega páginas quando troca de conta
  useEffect(() => {
    if (!integrationId) {
      setPages([]);
      return;
    }
    let cancelled = false;
    setPagesLoading(true);
    setPageId('');
    adsApi
      .listPages(integrationId)
      .then((p) => {
        if (cancelled) return;
        setPages(p);
        if (p.length === 1 && p[0]) setPageId(p[0].id);
      })
      .catch(() => {
        if (!cancelled) setPages([]);
      })
      .finally(() => {
        if (!cancelled) setPagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [integrationId]);

  const onGenerate = async () => {
    if (!integrationId) return setError('Selecione uma conta de anúncios.');
    if (!prodName.trim()) return setError('Informe o nome do produto.');
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const created = await adsApi.generate({
        integration_id: integrationId,
        objective,
        page_id: pageId || undefined,
        instagram_actor_id: pages.find((p) => p.id === pageId)?.instagram_actor_id ?? undefined,
        destination_url: destUrl.trim() || undefined,
        product: {
          name: prodName.trim(),
          description: prodDesc.trim() || undefined,
          price_brl: prodPrice ? Number(prodPrice) : undefined,
          image_url: prodImage.trim() || undefined,
        },
      });
      setComps((prev) => [created, ...prev]);
      setExpandedId(created.id);
      setNotice('Rascunho gerado pela IA. Revise os anúncios e a Página antes de publicar.');
      setProdName('');
      setProdDesc('');
      setProdPrice('');
      setProdImage('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao gerar.');
    } finally {
      setGenerating(false);
    }
  };

  const replaceComp = (c: AdComposition) =>
    setComps((prev) => prev.map((x) => (x.id === c.id ? c : x)));

  const onPublish = async (c: AdComposition) => {
    setBusyId(c.id);
    setError(null);
    setNotice(null);
    try {
      // garante page_id na composição (a Página é obrigatória pro criativo)
      if (!c.page_id) {
        if (!pageId) {
          setConfirmPublishId(null);
          throw new ApiError(400, 'Selecione uma Página do Facebook antes de publicar.', null);
        }
        await adsApi.update(c.id, { page_id: pageId });
      }
      const published = await adsApi.publish(c.id);
      replaceComp(published);
      setConfirmPublishId(null);
      setNotice(
        'Campanha criada no Meta como PAUSADA. Abra o Gerenciador de Anúncios pra revisar e ativar — nada gasta até você ativar.',
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao publicar.');
    } finally {
      setBusyId(null);
    }
  };

  const doAction = async (
    c: AdComposition,
    fn: (id: string) => Promise<AdComposition>,
    okMsg: string,
  ) => {
    setBusyId(c.id);
    setError(null);
    setNotice(null);
    try {
      const r = await fn(c.id);
      replaceComp(r);
      setNotice(okMsg);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha na ação.');
    } finally {
      setBusyId(null);
    }
  };

  const onArchive = async (c: AdComposition) => {
    setBusyId(c.id);
    try {
      await adsApi.archive(c.id);
      setComps((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao arquivar.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">
            <Megaphone className="h-6 w-6 text-violet-600" />
            Anúncios
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Crie campanhas no Meta (Facebook/Instagram) a partir dos seus produtos. A IA gera o
            criativo, você revisa e publica — sempre <strong>pausado</strong>, sem gastar nada até ativar.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading}>
          <RefreshCw className={cn('mr-1.5 h-4 w-4', loading && 'animate-spin')} />
          Atualizar
        </Button>
      </div>

      {/* Avisos */}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {!loading && metaIntegrations.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-700">
          Nenhuma conta Meta conectada. Conecte uma conta de anúncios em{' '}
          <strong>Configurações &gt; Integrações</strong> para começar.
        </div>
      )}

      {metaIntegrations.length > 0 && (
        <>
          {/* Conta + Página */}
          <div className="mb-5 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Conta de anúncios</label>
              <select
                value={integrationId}
                onChange={(e) => setIntegrationId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
              >
                {metaIntegrations.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.account_name ?? i.ad_account_id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Página do Facebook {pagesLoading && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
              </label>
              <select
                value={pageId}
                onChange={(e) => setPageId(e.target.value)}
                disabled={pagesLoading || pages.length === 0}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:bg-slate-900 dark:border-slate-700"
              >
                <option value="">{pages.length ? 'Selecione uma Página…' : 'Nenhuma Página disponível'}</option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.instagram_actor_id ? ' (+ Instagram)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Gerar com IA */}
          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:bg-slate-900 dark:border-slate-800">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <Sparkles className="h-4 w-4 text-violet-600" />
              Gerar campanha com IA
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={prodName}
                onChange={(e) => setProdName(e.target.value)}
                placeholder="Nome do produto *"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:bg-slate-950 dark:border-slate-700"
              />
              <input
                value={destUrl}
                onChange={(e) => setDestUrl(e.target.value)}
                placeholder="URL de destino (loja/produto)"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:bg-slate-950 dark:border-slate-700"
              />
              <input
                value={prodPrice}
                onChange={(e) => setProdPrice(e.target.value)}
                placeholder="Preço (R$)"
                inputMode="decimal"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:bg-slate-950 dark:border-slate-700"
              />
              <input
                value={prodImage}
                onChange={(e) => setProdImage(e.target.value)}
                placeholder="URL da imagem do produto"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:bg-slate-950 dark:border-slate-700"
              />
              <textarea
                value={prodDesc}
                onChange={(e) => setProdDesc(e.target.value)}
                placeholder="Descrição / diferenciais (opcional)"
                rows={2}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2 dark:bg-slate-950 dark:border-slate-700"
              />
              <select
                value={objective}
                onChange={(e) => setObjective(e.target.value as AdObjective)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-950 dark:border-slate-700"
              >
                {OBJECTIVES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <Button onClick={() => void onGenerate()} disabled={generating} className="sm:col-start-2">
                {generating ? (
                  <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Gerando…</>
                ) : (
                  <><Sparkles className="mr-1.5 h-4 w-4" /> Gerar rascunho</>
                )}
              </Button>
            </div>
          </div>

          {/* Lista de composições */}
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Suas campanhas ({comps.length})
          </h2>
          {loading ? (
            <div className="py-10 text-center text-slate-400">
              <Loader2 className="mx-auto h-6 w-6 animate-spin" />
            </div>
          ) : comps.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
              Nenhuma campanha ainda. Gere uma com a IA acima.
            </p>
          ) : (
            <ul className="space-y-3">
              {comps.map((c) => {
                const expanded = expandedId === c.id;
                const isBusy = busyId === c.id;
                return (
                  <li key={c.id} className="rounded-xl border border-slate-200 bg-white shadow-sm dark:bg-slate-900 dark:border-slate-800">
                    <button
                      onClick={() => setExpandedId(expanded ? null : c.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-slate-800 dark:text-slate-100">{c.name}</span>
                          <StatusPill status={c.status} />
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {brl(c.budget_daily_cents)}/dia · {c.duration_days} dias · {c.ad_copies.length} anúncios
                        </div>
                      </div>
                      {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                    </button>

                    {expanded && (
                      <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                        {c.last_error && (
                          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
                            Erro: {c.last_error}
                          </div>
                        )}

                        {/* Anúncios (variants) */}
                        <div className="grid gap-2 sm:grid-cols-3">
                          {c.ad_copies.map((copy) => (
                            <div key={copy.variant} className="rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-700">
                              <div className="mb-1 font-semibold text-violet-600">Variante {copy.variant}</div>
                              {copy.image_url && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={copy.image_url} alt="" className="mb-1.5 h-20 w-full rounded object-cover" />
                              )}
                              <div className="font-medium text-slate-800 dark:text-slate-100">{copy.headline}</div>
                              <p className="mt-1 line-clamp-3 text-slate-500">{copy.primary_text}</p>
                              <div className="mt-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {copy.cta}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Meta info */}
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>Objetivo: <strong>{OBJECTIVES.find((o) => o.value === c.objective)?.label ?? c.objective}</strong></span>
                          <span>Página: <strong>{c.page_id ? (pages.find((p) => p.id === c.page_id)?.name ?? c.page_id) : (pageId ? '— usará a selecionada acima' : '⚠ não definida')}</strong></span>
                          {c.destination_url && <span>Destino: <a className="text-violet-600 underline" href={c.destination_url} target="_blank" rel="noreferrer">link</a></span>}
                          {c.external_campaign_id && (
                            <a
                              className="inline-flex items-center gap-1 text-violet-600 underline"
                              href={`https://www.facebook.com/adsmanager/manage/campaigns?act=${c.ad_account_id.replace('act_', '')}&selected_campaign_ids=${c.external_campaign_id}`}
                              target="_blank" rel="noreferrer"
                            >
                              Abrir no Meta <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>

                        {/* Ações */}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {!c.external_campaign_id && c.status !== 'publishing' && (
                            confirmPublishId === c.id ? (
                              <div className="flex items-center gap-2 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs dark:bg-violet-950/40">
                                <span className="text-slate-600 dark:text-slate-300">Publicar no Meta (pausado)?</span>
                                <Button size="sm" onClick={() => void onPublish(c)} disabled={isBusy}>
                                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirmar'}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setConfirmPublishId(null)} disabled={isBusy}>
                                  Cancelar
                                </Button>
                              </div>
                            ) : (
                              <Button size="sm" onClick={() => setConfirmPublishId(c.id)} disabled={isBusy}>
                                <Rocket className="mr-1.5 h-4 w-4" /> Publicar
                              </Button>
                            )
                          )}
                          {c.status === 'published' && (
                            <Button size="sm" variant="outline" onClick={() => void doAction(c, adsApi.pause, 'Campanha pausada no Meta.')} disabled={isBusy}>
                              <Pause className="mr-1.5 h-4 w-4" /> Pausar
                            </Button>
                          )}
                          {c.status === 'paused' && (
                            <Button size="sm" variant="outline" onClick={() => void doAction(c, adsApi.resume, 'Campanha reativada no Meta.')} disabled={isBusy}>
                              <Play className="mr-1.5 h-4 w-4" /> Reativar
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-slate-400 hover:text-red-600" onClick={() => void onArchive(c)} disabled={isBusy}>
                            <Trash2 className="mr-1.5 h-4 w-4" /> Arquivar
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
