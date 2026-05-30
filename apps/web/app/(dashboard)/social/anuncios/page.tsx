'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Megaphone, Sparkles, Loader2, Play, Pause, Trash2, Rocket,
  CheckCircle2, AlertTriangle, ExternalLink, RefreshCw, ChevronDown, ChevronUp,
  Images, Film, ImageIcon, LayoutGrid, Users, UserPlus, Copy, BarChart3,
} from 'lucide-react';
import {
  adsApi,
  type AdAudience,
  type AdBreakdownRow,
  type AdComposition,
  type AdIntegration,
  type AdMetrics,
  type AdObjective,
  type AutopilotSuggestion,
  type BreakdownDimension,
  type MetaPage,
} from '@/lib/api/ads';
import { socialApi, type SocialContent } from '@/lib/api/social';
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

const FORMAT_META: Record<string, { label: string; Icon: typeof ImageIcon }> = {
  image: { label: 'Imagem', Icon: ImageIcon },
  carousel: { label: 'Carrossel', Icon: Images },
  video: { label: 'Vídeo', Icon: Film },
  reels: { label: 'Reels', Icon: Film },
};
const FMT_FALLBACK = { label: 'Imagem', Icon: ImageIcon };
function fmtMeta(key: string): { label: string; Icon: typeof ImageIcon } {
  return FORMAT_META[key] ?? FMT_FALLBACK;
}

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

function AutopilotPanel() {
  const [sugs, setSugs] = useState<AutopilotSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSugs(await adsApi.autopilot.suggestions()); } catch { setSugs([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const apply = async (s: AutopilotSuggestion) => {
    setBusy(s.signal_id); setMsg(null);
    try {
      await adsApi.autopilot.apply({ signal_id: s.signal_id, action: s.action, pct: s.pct });
      setSugs((p) => p.filter((x) => x.signal_id !== s.signal_id));
      setMsg(`✓ ${s.label} aplicado em "${s.campaign_name}".`);
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Falha ao aplicar.'); }
    finally { setBusy(null); }
  };
  const dismiss = async (s: AutopilotSuggestion) => {
    setBusy(s.signal_id);
    try { await adsApi.autopilot.dismiss(s.signal_id); setSugs((p) => p.filter((x) => x.signal_id !== s.signal_id)); }
    catch { /* noop */ } finally { setBusy(null); }
  };

  if (loading) return null;
  const n = sugs.length;
  return (
    <div className={cn('mb-5 rounded-xl border p-3', n > 0 ? 'border-amber-300 bg-amber-50/60' : 'border-border bg-card')}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left" disabled={n === 0}>
        <span className="flex items-center gap-2 text-sm font-semibold">
          🤖 Piloto automático
          {n > 0 ? <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">{n} otimização{n > 1 ? 'ões' : ''}</span>
                 : <span className="text-xs font-normal text-muted-foreground">— tudo certo, nada pendente</span>}
        </span>
        {n > 0 && (open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
      </button>
      {msg && <p className="mt-2 text-xs text-emerald-700">{msg}</p>}
      {open && n > 0 && (
        <ul className="mt-3 space-y-2">
          {sugs.map((s) => (
            <li key={s.signal_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', s.severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>{s.severity}</span>
                  <span className="truncate text-sm font-medium">{s.campaign_name}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.rationale}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" onClick={() => void apply(s)} disabled={busy === s.signal_id}>
                  {busy === s.signal_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : s.label}
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void dismiss(s)} disabled={busy === s.signal_id}>Dispensar</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MetricsPanel({ compId }: { compId: string }) {
  const [m, setM] = useState<AdMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [dim, setDim] = useState<BreakdownDimension | null>(null);
  const [rows, setRows] = useState<AdBreakdownRow[]>([]);
  const [bdLoading, setBdLoading] = useState(false);
  const [bdErr, setBdErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adsApi.metrics(compId)
      .then((r) => { if (!cancelled) setM(r); })
      .catch(() => { if (!cancelled) setM(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [compId]);

  const loadBreakdown = async (d: BreakdownDimension) => {
    setDim(d); setBdLoading(true); setBdErr(null);
    try { setRows(await adsApi.breakdown(compId, d)); }
    catch (e) { setBdErr(e instanceof ApiError ? e.message : 'Falha ao carregar.'); setRows([]); }
    finally { setBdLoading(false); }
  };

  const fmtN = (n: number) => Math.round(n).toLocaleString('pt-BR');
  if (loading) return <div className="py-3 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (!m?.available || !m.totals) {
    return <p className="text-xs text-muted-foreground">Sem dados ainda — as métricas aparecem algumas horas depois de ativar a campanha no Meta (o sync é horário).</p>;
  }
  const t = m.totals;
  const cells: Array<[string, string]> = [
    ['Gasto', brl(Math.round(t.spend * 100))],
    ['Impressões', fmtN(t.impressions)],
    ['Cliques', fmtN(t.clicks)],
    ['CTR', `${t.ctr.toFixed(2)}%`],
    ['CPC', brl(Math.round(t.cpc * 100))],
    ['Conversões', fmtN(t.conversions)],
  ];
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {cells.map(([label, val]) => (
          <div key={label} className="rounded-lg border border-border p-2 text-center">
            <div className="text-[10px] text-muted-foreground">{label}</div>
            <div className="text-sm font-semibold">{val}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Ver por:</span>
        {(['placement', 'age', 'gender'] as BreakdownDimension[]).map((d) => (
          <Button key={d} size="sm" variant={dim === d ? 'default' : 'outline'} onClick={() => void loadBreakdown(d)} disabled={bdLoading}>
            {d === 'placement' ? 'Posicionamento' : d === 'age' ? 'Idade' : 'Gênero'}
          </Button>
        ))}
      </div>
      {bdLoading && <div className="py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
      {bdErr && <p className="mt-2 text-xs text-red-600">{bdErr}</p>}
      {!bdLoading && dim && rows.length > 0 && (
        <ul className="mt-2 space-y-1">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between rounded border border-border px-2 py-1 text-xs">
              <span className="font-medium capitalize">{r.key}</span>
              <span className="text-muted-foreground">{brl(Math.round(r.spend * 100))} · {r.ctr.toFixed(2)}% CTR · {fmtN(r.conversions)} conv</span>
            </li>
          ))}
        </ul>
      )}
      {!bdLoading && dim && rows.length === 0 && !bdErr && <p className="mt-2 text-xs text-muted-foreground">Sem dados pra esse recorte ainda.</p>}
    </div>
  );
}

export default function AnunciosPage() {
  const [integrations, setIntegrations] = useState<AdIntegration[]>([]);
  const [comps, setComps] = useState<AdComposition[]>([]);
  const [pages, setPages] = useState<MetaPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [integrationId, setIntegrationId] = useState('');
  const [pageId, setPageId] = useState('');
  const [pagesLoading, setPagesLoading] = useState(false);

  // criação: modo IA | conteúdo do Studio
  const [mode, setMode] = useState<'ai' | 'content'>('ai');
  const [objective, setObjective] = useState<AdObjective>('conversions');
  const [destUrl, setDestUrl] = useState('');

  // form IA
  const [prodName, setProdName] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodPrice, setProdPrice] = useState('');
  const [prodImage, setProdImage] = useState('');
  const [generating, setGenerating] = useState(false);

  // picker de conteúdo
  const [contents, setContents] = useState<SocialContent[]>([]);
  const [contentsLoading, setContentsLoading] = useState(false);
  const [pickingId, setPickingId] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmPublishId, setConfirmPublishId] = useState<string | null>(null);

  // públicos
  const [audiences, setAudiences] = useState<AdAudience[]>([]);
  const [audienceId, setAudienceId] = useState(''); // id local selecionado p/ targeting
  const [showAudiences, setShowAudiences] = useState(false);
  const [audienceBusy, setAudienceBusy] = useState(false);
  const selectedAudienceExtId = useMemo(
    () => audiences.find((a) => a.id === audienceId)?.external_audience_id ?? null,
    [audiences, audienceId],
  );

  const metaIntegrations = useMemo(
    () => integrations.filter((i) => i.platform === 'meta' && i.status === 'active'),
    [integrations],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ints, list, auds] = await Promise.all([
        adsApi.listIntegrations(),
        adsApi.list(),
        adsApi.audiences.list().catch(() => [] as AdAudience[]),
      ]);
      setIntegrations(ints);
      setComps(list.filter((c) => c.status !== 'archived'));
      setAudiences(auds);
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

  useEffect(() => {
    if (!integrationId) { setPages([]); return; }
    let cancelled = false;
    setPagesLoading(true);
    setPageId('');
    adsApi.listPages(integrationId)
      .then((p) => { if (cancelled) return; setPages(p); if (p.length === 1 && p[0]) setPageId(p[0].id); })
      .catch(() => { if (!cancelled) setPages([]); })
      .finally(() => { if (!cancelled) setPagesLoading(false); });
    return () => { cancelled = true; };
  }, [integrationId]);

  // carrega conteúdos quando entra no modo "conteúdo"
  useEffect(() => {
    if (mode !== 'content' || contents.length) return;
    let cancelled = false;
    setContentsLoading(true);
    socialApi.contents
      .list({ status: ['approved', 'published'], page_size: 24 })
      .then((r) => { if (!cancelled) setContents(r.rows ?? []); })
      .catch(() => { if (!cancelled) setContents([]); })
      .finally(() => { if (!cancelled) setContentsLoading(false); });
    return () => { cancelled = true; };
  }, [mode, contents.length]);

  /** Injeta o público selecionado no targeting da composição recém-criada. */
  const applyAudience = async (c: AdComposition): Promise<AdComposition> => {
    if (!selectedAudienceExtId) return c;
    try {
      const existing = (c.targeting ?? {}) as Record<string, unknown>;
      return await adsApi.update(c.id, {
        targeting: { ...existing, custom_audiences: [{ id: selectedAudienceExtId }] },
      });
    } catch {
      return c;
    }
  };

  const onCreateAudienceFromCrm = async () => {
    if (!integrationId) return setError('Selecione uma conta de anúncios.');
    setAudienceBusy(true); setError(null); setNotice(null);
    try {
      const a = await adsApi.audiences.fromCrm({ integration_id: integrationId });
      setAudiences((prev) => [a, ...prev]);
      setNotice(`Público "${a.name}" criado com ${a.matched_count ?? 0} contatos. O Meta leva alguns minutos pra processar.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao criar público do CRM.');
    } finally { setAudienceBusy(false); }
  };

  const onCreateLookalike = async (source: AdAudience) => {
    if (!integrationId) return;
    setAudienceBusy(true); setError(null); setNotice(null);
    try {
      const a = await adsApi.audiences.lookalike({ integration_id: integrationId, source_audience_id: source.id });
      setAudiences((prev) => [a, ...prev]);
      setNotice(`Lookalike criado a partir de "${source.name}".`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao criar lookalike.');
    } finally { setAudienceBusy(false); }
  };

  const onArchiveAudience = async (a: AdAudience) => {
    setAudienceBusy(true);
    try {
      await adsApi.audiences.archive(a.id);
      setAudiences((prev) => prev.filter((x) => x.id !== a.id));
      if (audienceId === a.id) setAudienceId('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao arquivar público.');
    } finally { setAudienceBusy(false); }
  };

  const onGenerate = async () => {
    if (!integrationId) return setError('Selecione uma conta de anúncios.');
    if (!prodName.trim()) return setError('Informe o nome do produto.');
    setGenerating(true);
    setError(null); setNotice(null);
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
      const withAud = await applyAudience(created);
      setComps((prev) => [withAud, ...prev]);
      setExpandedId(withAud.id);
      setNotice('Rascunho gerado pela IA. Revise antes de publicar.');
      setProdName(''); setProdDesc(''); setProdPrice(''); setProdImage('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao gerar.');
    } finally { setGenerating(false); }
  };

  const onPickContent = async (content: SocialContent) => {
    if (!integrationId) return setError('Selecione uma conta de anúncios.');
    setPickingId(content.id);
    setError(null); setNotice(null);
    try {
      const created = await adsApi.fromContent({
        integration_id: integrationId,
        content_id: content.id,
        page_id: pageId || undefined,
        instagram_actor_id: pages.find((p) => p.id === pageId)?.instagram_actor_id ?? undefined,
        objective,
        destination_url: destUrl.trim() || undefined,
      });
      const withAud = await applyAudience(created);
      setComps((prev) => [withAud, ...prev]);
      setExpandedId(withAud.id);
      setNotice(`Anúncio (${fmtMeta(created.creative_format).label}) criado a partir do conteúdo. Revise antes de publicar.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao usar o conteúdo.');
    } finally { setPickingId(null); }
  };

  const replaceComp = (c: AdComposition) => setComps((prev) => prev.map((x) => (x.id === c.id ? c : x)));

  const onPublish = async (c: AdComposition) => {
    setBusyId(c.id); setError(null); setNotice(null);
    try {
      if (!c.page_id && !c.object_story_id) {
        if (!pageId) { setConfirmPublishId(null); throw new ApiError(400, 'Selecione uma Página do Facebook antes de publicar.', null); }
        await adsApi.update(c.id, { page_id: pageId });
      }
      const published = await adsApi.publish(c.id);
      replaceComp(published);
      setConfirmPublishId(null);
      setNotice('Campanha criada no Meta como PAUSADA. Abra o Gerenciador pra revisar e ativar — nada gasta até ativar.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao publicar.');
    } finally { setBusyId(null); }
  };

  const doAction = async (c: AdComposition, fn: (id: string) => Promise<AdComposition>, okMsg: string) => {
    setBusyId(c.id); setError(null); setNotice(null);
    try { const r = await fn(c.id); replaceComp(r); setNotice(okMsg); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha na ação.'); }
    finally { setBusyId(null); }
  };

  const onArchive = async (c: AdComposition) => {
    setBusyId(c.id);
    try { await adsApi.archive(c.id); setComps((prev) => prev.filter((x) => x.id !== c.id)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao arquivar.'); }
    finally { setBusyId(null); }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header estilo Studio */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/social"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <Megaphone className="h-5 w-5 text-violet-600" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Anúncios</h1>
            <p className="text-xs text-muted-foreground">Campanhas pagas no Meta — sempre pausadas até você ativar.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading}>
          <RefreshCw className={cn('mr-1.5 h-4 w-4', loading && 'animate-spin')} /> Atualizar
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-5xl">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{notice}</span>
            </div>
          )}

          {!loading && metaIntegrations.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-700">
              Nenhuma conta Meta conectada. Conecte em <strong>Configurações &gt; Integrações</strong>.
            </div>
          )}

          {metaIntegrations.length > 0 && <AutopilotPanel />}

          {metaIntegrations.length > 0 && (
            <>
              {/* Conta + Página + objetivo + destino */}
              <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Conta de anúncios</label>
                  <select value={integrationId} onChange={(e) => setIntegrationId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    {metaIntegrations.map((i) => <option key={i.id} value={i.id}>{i.account_name ?? i.ad_account_id}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Página {pagesLoading && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
                  </label>
                  <select value={pageId} onChange={(e) => setPageId(e.target.value)} disabled={pagesLoading || !pages.length} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-60">
                    <option value="">{pages.length ? 'Selecione…' : 'Nenhuma Página'}</option>
                    {pages.map((p) => <option key={p.id} value={p.id}>{p.name}{p.instagram_actor_id ? ' (+IG)' : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Objetivo</label>
                  <select value={objective} onChange={(e) => setObjective(e.target.value as AdObjective)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    {OBJECTIVES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">URL de destino</label>
                  <input value={destUrl} onChange={(e) => setDestUrl(e.target.value)} placeholder="loja/produto" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                </div>
              </div>

              {/* Público + gerenciar */}
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div className="min-w-[240px] flex-1">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Público (opcional)</label>
                  <select value={audienceId} onChange={(e) => setAudienceId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    <option value="">Público amplo (segmentação da IA)</option>
                    {audiences.filter((a) => a.status === 'ready' && a.external_audience_id).map((a) => (
                      <option key={a.id} value={a.id}>{a.type === 'lookalike' ? '🔁 ' : '👥 '}{a.name}</option>
                    ))}
                  </select>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowAudiences((v) => !v)}>
                  <Users className="mr-1.5 h-4 w-4" /> Gerenciar públicos
                </Button>
              </div>

              {/* Painel de Públicos */}
              {showAudiences && (
                <div className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4 text-violet-600" /> Públicos do CRM</h2>
                    <Button size="sm" onClick={() => void onCreateAudienceFromCrm()} disabled={audienceBusy}>
                      {audienceBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserPlus className="mr-1.5 h-4 w-4" />} Criar do CRM
                    </Button>
                  </div>
                  <p className="mb-3 text-xs text-muted-foreground">Transforme seus contatos (e-mail/telefone) num público do Meta e gere um <strong>Lookalike</strong> pra alcançar gente parecida. Os dados vão hasheados — nada de PII em claro.</p>
                  {audiences.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">Nenhum público ainda. Crie o primeiro a partir do seu CRM.</p>
                  ) : (
                    <ul className="space-y-2">
                      {audiences.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">{a.name}</span>
                              <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px]', a.type === 'lookalike' ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-violet-200 bg-violet-50 text-violet-600')}>{a.type === 'lookalike' ? 'Lookalike' : 'CRM'}</span>
                              <span className={cn('rounded-full px-1.5 py-0.5 text-[10px]', a.status === 'ready' ? 'bg-emerald-50 text-emerald-700' : a.status === 'error' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600')}>{a.status === 'ready' ? 'pronto' : a.status === 'error' ? 'erro' : 'processando'}</span>
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {a.matched_count != null && `${a.matched_count.toLocaleString('pt-BR')} contatos`}
                              {a.approximate_count != null && ` · ~${a.approximate_count.toLocaleString('pt-BR')} no Meta`}
                              {a.last_error && <span className="text-red-600"> · {a.last_error}</span>}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {a.type === 'custom' && a.status === 'ready' && (
                              <Button size="sm" variant="outline" onClick={() => void onCreateLookalike(a)} disabled={audienceBusy}><Copy className="mr-1 h-3.5 w-3.5" /> Lookalike</Button>
                            )}
                            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-600" onClick={() => void onArchiveAudience(a)} disabled={audienceBusy}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Toggle de modo */}
              <div className="mb-4 inline-flex rounded-lg border border-border p-1">
                <button onClick={() => setMode('ai')} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium', mode === 'ai' ? 'bg-violet-600 text-white' : 'text-muted-foreground')}>
                  <Sparkles className="h-4 w-4" /> Gerar com IA
                </button>
                <button onClick={() => setMode('content')} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium', mode === 'content' ? 'bg-violet-600 text-white' : 'text-muted-foreground')}>
                  <LayoutGrid className="h-4 w-4" /> Usar conteúdo do Studio
                </button>
              </div>

              {/* Modo IA */}
              {mode === 'ai' && (
                <div className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input value={prodName} onChange={(e) => setProdName(e.target.value)} placeholder="Nome do produto *" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                    <input value={prodPrice} onChange={(e) => setProdPrice(e.target.value)} placeholder="Preço (R$)" inputMode="decimal" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                    <input value={prodImage} onChange={(e) => setProdImage(e.target.value)} placeholder="URL da imagem do produto" className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2" />
                    <textarea value={prodDesc} onChange={(e) => setProdDesc(e.target.value)} placeholder="Descrição / diferenciais (opcional)" rows={2} className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2" />
                    <Button onClick={() => void onGenerate()} disabled={generating} className="sm:col-start-2">
                      {generating ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Gerando…</> : <><Sparkles className="mr-1.5 h-4 w-4" /> Gerar rascunho</>}
                    </Button>
                  </div>
                </div>
              )}

              {/* Modo conteúdo do Studio */}
              {mode === 'content' && (
                <div className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm">
                  <p className="mb-3 text-xs text-muted-foreground">Escolha um post, carrossel ou reel já criado no Studio pra transformar em anúncio pago. O formato é detectado automaticamente.</p>
                  {contentsLoading ? (
                    <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
                  ) : contents.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">Nenhum conteúdo aprovado/publicado. Crie em <Link href="/social/criar" className="text-violet-600 underline">Criar conteúdo</Link>.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                      {contents.map((ct) => {
                        const fm = fmtMeta(ct.content_type === 'carousel' ? 'carousel' : ct.content_type === 'post' ? 'image' : 'reels');
                        const Icon = fm.Icon;
                        return (
                          <button key={ct.id} onClick={() => void onPickContent(ct)} disabled={!!pickingId} className="group relative overflow-hidden rounded-lg border border-border text-left transition hover:border-violet-400 disabled:opacity-50">
                            <div className="aspect-square w-full bg-muted">
                              {ct.cover_image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={ct.cover_image_url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-muted-foreground"><Icon className="h-6 w-6" /></div>
                              )}
                              {pickingId === ct.id && <div className="absolute inset-0 flex items-center justify-center bg-black/40"><Loader2 className="h-5 w-5 animate-spin text-white" /></div>}
                            </div>
                            <div className="flex items-center gap-1 px-2 py-1.5 text-[11px]">
                              <Icon className="h-3 w-3 shrink-0 text-violet-600" />
                              <span className="truncate">{ct.title || ct.caption || fm.label}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Lista de composições */}
              <h2 className="mb-2 text-sm font-semibold">Suas campanhas ({comps.length})</h2>
              {loading ? (
                <div className="py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
              ) : comps.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">Nenhuma campanha ainda. Gere uma ou use um conteúdo do Studio.</p>
              ) : (
                <ul className="space-y-3">
                  {comps.map((c) => {
                    const expanded = expandedId === c.id;
                    const isBusy = busyId === c.id;
                    const fm = fmtMeta(c.creative_format);
                    const FmtIcon = fm.Icon;
                    return (
                      <li key={c.id} className="rounded-xl border border-border bg-card shadow-sm">
                        <button onClick={() => setExpandedId(expanded ? null : c.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700"><FmtIcon className="h-3 w-3" />{fm.label}</span>
                              <span className="truncate font-medium">{c.name}</span>
                              <StatusPill status={c.status} />
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {brl(c.budget_daily_cents)}/dia · {c.duration_days} dias
                              {c.creative_format === 'carousel' && ` · ${c.cards?.length ?? 0} cards`}
                              {(c.creative_format === 'video' || c.creative_format === 'reels') && ' · vídeo'}
                              {c.creative_format === 'image' && ` · ${c.ad_copies?.length ?? 0} anúncios`}
                            </div>
                          </div>
                          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </button>

                        {expanded && (
                          <div className="border-t border-border px-4 py-3">
                            {c.last_error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">Erro: {c.last_error}</div>}

                            {/* Preview por formato */}
                            {c.creative_format === 'carousel' ? (
                              <div className="mb-3 flex gap-2 overflow-x-auto">
                                {(c.cards ?? []).map((card, i) => (
                                  <div key={i} className="w-28 shrink-0 rounded-lg border border-border p-1.5 text-xs">
                                    {card.image_url && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={card.image_url} alt="" className="mb-1 h-20 w-full rounded object-cover" />)}
                                    <div className="truncate font-medium">{card.headline}</div>
                                  </div>
                                ))}
                              </div>
                            ) : (c.creative_format === 'video' || c.creative_format === 'reels') ? (
                              <div className="mb-3 flex items-center gap-3">
                                {c.video?.thumbnail_url && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={c.video.thumbnail_url} alt="" className="h-24 w-16 rounded object-cover" />)}
                                <div className="text-xs text-muted-foreground">{c.ad_copies?.[0]?.primary_text}</div>
                              </div>
                            ) : (
                              <div className="mb-3 grid gap-2 sm:grid-cols-3">
                                {(c.ad_copies ?? []).map((copy) => (
                                  <div key={copy.variant} className="rounded-lg border border-border p-2.5 text-xs">
                                    <div className="mb-1 font-semibold text-violet-600">Variante {copy.variant}</div>
                                    {copy.image_url && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={copy.image_url} alt="" className="mb-1.5 h-20 w-full rounded object-cover" />)}
                                    <div className="font-medium">{copy.headline}</div>
                                    <p className="mt-1 line-clamp-3 text-muted-foreground">{copy.primary_text}</p>
                                    <div className="mt-1.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{copy.cta}</div>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span>Objetivo: <strong>{OBJECTIVES.find((o) => o.value === c.objective)?.label ?? c.objective}</strong></span>
                              <span>Página: <strong>{c.page_id ? (pages.find((p) => p.id === c.page_id)?.name ?? c.page_id) : (pageId ? '— usará a selecionada' : '⚠ não definida')}</strong></span>
                              {c.external_campaign_id && (
                                <a className="inline-flex items-center gap-1 text-violet-600 underline" href={`https://www.facebook.com/adsmanager/manage/campaigns?act=${c.ad_account_id.replace('act_', '')}&selected_campaign_ids=${c.external_campaign_id}`} target="_blank" rel="noreferrer">Abrir no Meta <ExternalLink className="h-3 w-3" /></a>
                              )}
                            </div>

                            {c.external_campaign_id && (
                              <div className="mb-3 rounded-lg bg-muted/40 p-3">
                                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><BarChart3 className="h-3.5 w-3.5" /> Desempenho (30 dias)</h4>
                                <MetricsPanel compId={c.id} />
                              </div>
                            )}

                            <div className="flex flex-wrap items-center gap-2">
                              {!c.external_campaign_id && c.status !== 'publishing' && (
                                confirmPublishId === c.id ? (
                                  <div className="flex items-center gap-2 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs">
                                    <span className="text-slate-600">Publicar no Meta (pausado)?</span>
                                    <Button size="sm" onClick={() => void onPublish(c)} disabled={isBusy}>{isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirmar'}</Button>
                                    <Button size="sm" variant="ghost" onClick={() => setConfirmPublishId(null)} disabled={isBusy}>Cancelar</Button>
                                  </div>
                                ) : (
                                  <Button size="sm" onClick={() => setConfirmPublishId(c.id)} disabled={isBusy}><Rocket className="mr-1.5 h-4 w-4" /> Publicar</Button>
                                )
                              )}
                              {c.status === 'published' && <Button size="sm" variant="outline" onClick={() => void doAction(c, adsApi.pause, 'Campanha pausada no Meta.')} disabled={isBusy}><Pause className="mr-1.5 h-4 w-4" /> Pausar</Button>}
                              {c.status === 'paused' && <Button size="sm" variant="outline" onClick={() => void doAction(c, adsApi.resume, 'Campanha reativada no Meta.')} disabled={isBusy}><Play className="mr-1.5 h-4 w-4" /> Reativar</Button>}
                              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-600" onClick={() => void onArchive(c)} disabled={isBusy}><Trash2 className="mr-1.5 h-4 w-4" /> Arquivar</Button>
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
      </div>
    </div>
  );
}
