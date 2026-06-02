'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Gauge, RefreshCw, Sparkles, TrendingUp, TrendingDown, Minus, Wallet,
  Target, DollarSign, Layers, Building2, ListChecks, Check, X, Play, Pause,
  Plus, ChevronRight, Activity, AlertTriangle, Zap, ArrowRight, Power, RotateCcw,
  ExternalLink, Trash2, Rocket,
} from 'lucide-react';
import {
  adsCentralApi, AdsOverview, AccountOverview, AdsDecision, AccountCampaigns,
  CampaignDossier, EnrollableIntegration, DecisionType, DecisionStatus,
} from '@/lib/api/ads-central';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// ────────────────────────────────────────────
// helpers de formatação
// ────────────────────────────────────────────
const brlFromCents = (c: number | null | undefined) =>
  c == null ? '—' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (n: number | null | undefined, d = 0) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(2)}%`);
const x = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(2)}×`);

function relTime(iso: string | null): string {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

const DECISION_META: Record<DecisionType, { label: string; tone: Tone; icon: typeof Zap }> = {
  scale_budget: { label: 'Escalar orçamento', tone: 'emerald', icon: TrendingUp },
  reduce_budget: { label: 'Reduzir orçamento', tone: 'amber', icon: TrendingDown },
  pause: { label: 'Pausar', tone: 'red', icon: Pause },
  activate: { label: 'Reativar', tone: 'cyan', icon: Play },
  adjust_bid: { label: 'Ajustar lance', tone: 'cyan', icon: Activity },
  reallocate: { label: 'Realocar verba', tone: 'violet', icon: ArrowRight },
  // nível ANÚNCIO (ML copiloto)
  pause_ad: { label: 'Pausar anúncio', tone: 'red', icon: Pause },
  remove_ad: { label: 'Remover anúncio', tone: 'red', icon: Trash2 },
  boost_ad: { label: 'Impulsionar anúncio', tone: 'emerald', icon: Rocket },
};

type Tone = 'cyan' | 'emerald' | 'amber' | 'red' | 'violet' | 'zinc';
const TONE: Record<Tone, { text: string; bg: string; border: string; rule: string }> = {
  cyan: { text: 'text-cyan-300', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', rule: 'bg-cyan-400' },
  emerald: { text: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', rule: 'bg-emerald-400' },
  amber: { text: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/30', rule: 'bg-amber-400' },
  red: { text: 'text-red-300', bg: 'bg-red-500/10', border: 'border-red-500/30', rule: 'bg-red-400' },
  violet: { text: 'text-violet-300', bg: 'bg-violet-500/10', border: 'border-violet-500/30', rule: 'bg-violet-400' },
  zinc: { text: 'text-zinc-300', bg: 'bg-zinc-500/10', border: 'border-zinc-500/30', rule: 'bg-zinc-400' },
};

// ════════════════════════════════════════════
// Página
// ════════════════════════════════════════════
export default function AdsCentralPage() {
  const [overview, setOverview] = useState<AdsOverview | null>(null);
  const [decisions, setDecisions] = useState<AdsDecision[]>([]);
  const [integrations, setIntegrations] = useState<EnrollableIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<AccountCampaigns | null>(null);
  const [campLoading, setCampLoading] = useState(false);
  const [decFilter, setDecFilter] = useState<DecisionStatus>('pending');

  const setB = (k: string, v: boolean) => setBusy((p) => ({ ...p, [k]: v }));

  const loadCore = useCallback(async (filter: DecisionStatus = 'pending') => {
    const [ov, dec, ints] = await Promise.all([
      adsCentralApi.overview(),
      adsCentralApi.decisions(filter),
      adsCentralApi.integrations().catch(() => [] as EnrollableIntegration[]),
    ]);
    setOverview(ov);
    setDecisions(dec);
    setIntegrations(ints);
  }, []);

  const switchFilter = async (f: DecisionStatus) => {
    setDecFilter(f);
    setB('decFilter', true);
    try { setDecisions(await adsCentralApi.decisions(f)); } catch { /* mantém */ }
    finally { setB('decFilter', false); }
  };

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadCore(decFilter);
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Falha ao carregar a Central de Ads.');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadCore]);

  const refresh = async () => {
    setB('refresh', true);
    try { await loadCore(); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao atualizar.'); }
    finally { setB('refresh', false); }
  };

  const enrolledExternal = useMemo(
    () => new Set((overview?.accounts ?? []).map((a) => a.id)),
    [overview],
  );
  const enrollable = useMemo(() => {
    const names = new Set((overview?.accounts ?? []).map((a) => a.name));
    return integrations.filter(
      (i) => i.status === 'active' && i.platform === 'meta' && !names.has(i.account_name),
    );
  }, [integrations, overview]);

  const openCampaigns = async (accountId: string) => {
    if (selected === accountId) { setSelected(null); setCampaigns(null); return; }
    setSelected(accountId);
    setCampLoading(true);
    try { setCampaigns(await adsCentralApi.campaigns(accountId)); }
    catch { setCampaigns(null); }
    finally { setCampLoading(false); }
  };

  const onAccountAction = async (id: string, action: 'sync' | 'analyze' | 'toggle', acc: AccountOverview) => {
    setB(`${action}:${id}`, true);
    try {
      if (action === 'sync') await adsCentralApi.sync(id);
      else if (action === 'analyze') await adsCentralApi.analyze(id);
      else await adsCentralApi.setAccountStatus(id, acc.status === 'active' ? 'paused' : 'active');
      await loadCore(decFilter);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ação falhou.');
    } finally { setB(`${action}:${id}`, false); }
  };

  const onSetMode = async (id: string, mode: 'copilot' | 'auto') => {
    if (
      mode === 'auto' &&
      !window.confirm(
        'Modo AUTOMÁTICO: o motor vai aplicar sozinho ações de proteção (pausar / reduzir orçamento) de alta confiança, dentro de ±20% e reversíveis. Escalar orçamento continua manual. Ativar?',
      )
    ) {
      return;
    }
    setB(`mode:${id}`, true);
    try {
      await adsCentralApi.setMode(id, mode);
      await loadCore(decFilter);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao trocar o modo.');
    } finally {
      setB(`mode:${id}`, false);
    }
  };

  const analyzeAll = async () => {
    const active = (overview?.accounts ?? []).filter((a) => a.status === 'active');
    setB('analyzeAll', true);
    try {
      await Promise.all(active.map((a) => adsCentralApi.analyze(a.id).catch(() => null)));
      await loadCore(decFilter);
    } finally { setB('analyzeAll', false); }
  };

  const enroll = async (integrationId: string) => {
    setB(`enroll:${integrationId}`, true);
    try { await adsCentralApi.enroll(integrationId); await loadCore(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao matricular.'); }
    finally { setB(`enroll:${integrationId}`, false); }
  };

  const onDecide = async (id: string, verdict: 'approve' | 'reject', editedBudgetBrl?: number) => {
    setB(`dec:${id}`, true);
    // otimista: remove da fila
    setDecisions((p) => p.filter((d) => d.id !== id));
    try {
      if (verdict === 'approve') {
        if (editedBudgetBrl != null) await adsCentralApi.editBudget(id, editedBudgetBrl);
        await adsCentralApi.approve(id);
      } else {
        await adsCentralApi.reject(id);
      }
      const [ov, dec] = await Promise.all([adsCentralApi.overview(), adsCentralApi.decisions(decFilter)]);
      setOverview(ov); setDecisions(dec);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao aplicar a decisão.');
      setDecisions(await adsCentralApi.decisions(decFilter).catch(() => []));
    } finally { setB(`dec:${id}`, false); }
  };

  const onRollback = async (id: string) => {
    setB(`dec:${id}`, true);
    setDecisions((p) => p.filter((d) => d.id !== id));
    try {
      await adsCentralApi.rollback(id);
      const [ov, dec] = await Promise.all([adsCentralApi.overview(), adsCentralApi.decisions(decFilter)]);
      setOverview(ov); setDecisions(dec);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao reverter.');
      setDecisions(await adsCentralApi.decisions(decFilter).catch(() => []));
    } finally { setB(`dec:${id}`, false); }
  };

  const t = overview?.totals;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/30">
            <Gauge className="h-5 w-5" />
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
            </span>
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight tracking-tight">Central de Ads</h1>
            <p className="text-xs text-muted-foreground">
              Piloto de performance · otimização contínua multi-plataforma
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={analyzeAll}
            disabled={busy.analyzeAll || !t?.active_accounts}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
          >
            <Sparkles className={cn('h-3.5 w-3.5', busy.analyzeAll && 'animate-pulse')} />
            Analisar tudo
          </button>
          <button
            onClick={refresh}
            disabled={busy.refresh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/40 disabled:opacity-40"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', busy.refresh && 'animate-spin')} />
            Atualizar
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-4 md:p-6">
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {loading ? (
          <SkeletonBoard />
        ) : !overview || overview.totals.accounts === 0 ? (
          <EmptyState enrollable={enrollable} onEnroll={enroll} busy={busy} />
        ) : (
          <>
            {/* HERO KPIs */}
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              <Kpi icon={Wallet} label={`Gasto ${overview.window_days}d`} value={brlFromCents(t!.spend_cents)} />
              <Kpi icon={Target} label="Resultados 7d" value={num(t!.results)} tone="cyan" />
              <Kpi icon={DollarSign} label="Custo / resultado" value={brlFromCents(t!.cost_per_result_cents)} />
              <Kpi icon={TrendingUp} label="ROAS médio" value={x(t!.roas)} tone={t!.roas != null && t!.roas >= 1 ? 'emerald' : 'zinc'} />
              <Kpi icon={Building2} label="Contas ativas" value={`${t!.active_accounts}/${t!.accounts}`} />
              <Kpi icon={Layers} label="Campanhas ativas" value={`${t!.active_campaigns}`} sub={`${t!.campaigns} no total`} />
              <Kpi icon={ListChecks} label="Decisões na fila" value={`${t!.pending_decisions}`} tone={t!.pending_decisions > 0 ? 'amber' : 'zinc'} highlight={t!.pending_decisions > 0} />
            </section>

            {/* enrollable banner */}
            {enrollable.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                <Plus className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-sm text-foreground/80">
                  {enrollable.length} conta(s) Meta conectada(s) ainda fora do motor:
                </span>
                <div className="flex flex-wrap gap-2">
                  {enrollable.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => enroll(i.id)}
                      disabled={busy[`enroll:${i.id}`]}
                      className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
                    >
                      + {i.account_name ?? i.ad_account_id}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* DECISÕES */}
            <section>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <ListChecks className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Fila de decisões</h2>
                <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums">{decisions.length}</span>
                <div className="ml-auto inline-flex rounded-lg border border-border bg-card p-0.5">
                  {([['pending', 'Pendentes'], ['applied', 'Aplicadas'], ['rejected', 'Rejeitadas']] as const).map(([f, label]) => (
                    <button key={f} onClick={() => switchFilter(f)} disabled={busy.decFilter}
                      className={cn('rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        decFilter === f ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {decFilter === 'pending' && (
                <p className="mb-3 text-xs text-muted-foreground">O copiloto sugere; você decide. Ao aprovar, a mudança é aplicada de verdade no Meta — e pode ser revertida em 1 clique.</p>
              )}
              {decisions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/10 p-8 text-center">
                  <ListChecks className="mx-auto mb-2 h-7 w-7 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    {decFilter === 'pending'
                      ? 'Nenhuma sugestão pendente. O motor analisa as contas a cada ciclo e enfileira aqui o que valer a pena.'
                      : decFilter === 'applied' ? 'Nenhuma decisão aplicada ainda.' : 'Nenhuma decisão rejeitada.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {decisions.map((d, i) => (
                    <DecisionCard key={d.id} d={d} busy={!!busy[`dec:${d.id}`]} onDecide={onDecide} onRollback={onRollback} index={i}
                      platform={overview.accounts.find((a) => a.id === d.account_id)?.platform} />
                  ))}
                </div>
              )}
            </section>

            {/* CONTAS */}
            <section>
              <SectionTitle icon={Building2} title="Contas conectadas" count={overview.accounts.length} />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {overview.accounts.map((a) => (
                  <AccountCard
                    key={a.id} a={a} busy={busy} selected={selected === a.id}
                    onAction={onAccountAction} onOpen={() => openCampaigns(a.id)} onSetMode={onSetMode}
                  />
                ))}
              </div>
            </section>

            {/* CAMPANHAS (drill) */}
            {selected && (
              <section>
                <SectionTitle icon={Layers} title={`Campanhas · ${overview.accounts.find((a) => a.id === selected)?.name ?? ''}`} />
                <CampaignsTable data={campaigns} loading={campLoading} />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// Subcomponentes
// ════════════════════════════════════════════

function SectionTitle({ icon: Icon, title, count, hint }: { icon: typeof Zap; title: string; count?: number; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-primary" />
      <h2 className="text-sm font-semibold">{title}</h2>
      {count != null && (
        <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums">{count}</span>
      )}
      {hint && <span className="ml-auto hidden text-xs text-muted-foreground md:block">{hint}</span>}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone = 'zinc', highlight }: {
  icon: typeof Zap; label: string; value: string; sub?: string; tone?: Tone; highlight?: boolean;
}) {
  const tn = TONE[tone];
  return (
    <div className={cn(
      'group relative overflow-hidden rounded-xl border bg-card p-3 transition-colors',
      highlight ? cn(tn.border, tn.bg) : 'border-border hover:border-primary/30',
    )}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className={cn('h-3.5 w-3.5', tone !== 'zinc' && tn.text)} /> {label}
      </div>
      <div className={cn('text-2xl font-semibold leading-none tabular-nums', highlight && tn.text)}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const p = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  const tone = p >= 75 ? 'bg-emerald-400' : p >= 60 ? 'bg-cyan-400' : 'bg-amber-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${p}%` }} />
      </div>
      <span className="text-[11px] font-medium text-muted-foreground tabular-nums">{p}%</span>
    </div>
  );
}

function DecisionCard({ d, busy, onDecide, onRollback, index, platform }: {
  d: AdsDecision; busy: boolean; index: number; platform?: string;
  onDecide: (id: string, v: 'approve' | 'reject', edited?: number) => void;
  onRollback: (id: string) => void;
}) {
  const isPending = d.status === 'pending';
  const meta = DECISION_META[d.type] ?? DECISION_META.adjust_bid;
  const tn = TONE[meta.tone];
  const Icon = meta.icon;
  const beforeCents = typeof d.before?.budget_cents === 'number' ? (d.before.budget_cents as number) : null;
  const afterCents = typeof d.after?.budget_cents === 'number' ? (d.after.budget_cents as number) : null;
  const isBudget = beforeCents != null && afterCents != null;
  const minB = beforeCents != null ? Math.round((beforeCents * 0.8) / 100) : 0;
  const maxB = beforeCents != null ? Math.round((beforeCents * 1.2) / 100) : 0;
  const [edited, setEdited] = useState<number>(afterCents != null ? Math.round(afterCents / 100) : 0);
  const statusAfter = typeof d.after?.status === 'string' ? (d.after.status as string) : null;
  const acosAfter = typeof d.after?.acos_target === 'number' ? (d.after.acos_target as number) : null;
  const acosBefore = typeof d.before?.acos_target === 'number' ? (d.before.acos_target as number) : null;
  const signalChips = Object.entries(d.signals ?? {}).slice(0, 4);

  // Nível ANÚNCIO (F12 Fase 4): pause_ad / remove_ad / boost_ad. before carrega
  // a campanha-pai (campaign_id) e o link público do anúncio (permalink).
  const isAdLevel = d.type === 'pause_ad' || d.type === 'remove_ad' || d.type === 'boost_ad';
  const adCampaignId = typeof d.before?.campaign_id === 'string' ? (d.before.campaign_id as string) : null;
  const adPermalink = typeof d.before?.permalink === 'string' ? (d.before.permalink as string) : null;
  const adName = d.entity_name ?? 'o anúncio';
  // MLB do anúncio (item_id) + nome da campanha-pai — pra operar manualmente no painel.
  const adItemMlb = (typeof d.before?.item_id === 'string' ? (d.before.item_id as string) : null) ?? d.entity_external_id ?? null;
  const adCampaignName = d.campaign_name ?? null;

  // Mercado Livre: aplicação automática (write) ainda pendente de liberação do
  // Mercado Ads. Vira copiloto — mostramos o ROAS Objetivo (unidade do painel ML,
  // ROAS = 100/ACOS) + instrução exata + link pro painel. Decisões de anúncio
  // são SEMPRE copiloto ML (escrita no Product Ads bloqueada).
  const isMl = platform === 'mercadolivre' || isAdLevel;
  const acosToRoas = (a: number) => Math.round((100 / a) * 10) / 10;
  const roasAfter = acosAfter != null && acosAfter > 0 ? acosToRoas(acosAfter) : null;
  const roasBefore = acosBefore != null && acosBefore > 0 ? acosToRoas(acosBefore) : null;
  const campName = d.entity_name ?? 'a campanha';
  const mlInstruction = !isMl
    ? null
    : isAdLevel
      ? d.type === 'pause_ad'
        ? `Pause o anúncio "${adName}" dentro da campanha — está consumindo verba sem converter.`
        : d.type === 'remove_ad'
          ? `Remova o anúncio "${adName}" da campanha — gasto relevante e sem retorno.`
          : adCampaignId
            ? `Reative/impulsione o anúncio "${adName}" — o Mercado Livre recomenda anunciá-lo.`
            : `Inclua o item "${adName}" em uma campanha de Product Ads para impulsioná-lo.`
      : roasAfter != null
        ? `Ajuste o ROAS Objetivo de "${campName}" para ${roasAfter}× (ACOS-alvo ≈ ${acosAfter}%).`
        : statusAfter === 'paused'
          ? `Pause "${campName}".`
          : statusAfter === 'active'
            ? `Ative "${campName}".`
            : isBudget
              ? `Ajuste o orçamento diário de "${campName}" para ${brl(edited)}.`
              : `Abra "${campName}" no Mercado Ads e aplique o ajuste sugerido.`;
  // Deep-link: abre direto o dashboard DA campanha no painel do Mercado Ads
  // (edição é por campanha — inclusive pausar/remover anúncio dela). Pra anúncio,
  // usa a campanha-pai (before.campaign_id). Fallback: lista de campanhas.
  const mlAdminBase = 'https://www.mercadolivre.com.br/publicidade/product-ads/admin/campaigns';
  const mlDeepLinkId = isAdLevel ? adCampaignId : d.entity_external_id;
  const mlCampaignUrl = mlDeepLinkId
    ? `${mlAdminBase}/${mlDeepLinkId}/dashboard?navigate_to=seller_central`
    : `${mlAdminBase}?navigate_to=seller_central`;

  return (
    <div
      className={cn('relative overflow-hidden rounded-xl border bg-card p-4 pl-5 animate-in fade-in slide-in-from-bottom-2', tn.border)}
      style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'backwards' }}
    >
      <span className={cn('absolute inset-y-0 left-0 w-1', tn.rule)} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={cn('mb-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold', tn.border, tn.bg, tn.text)}>
            <Icon className="h-3 w-3" /> {meta.label}
          </div>
          <h3 className="truncate text-sm font-medium" title={d.entity_name ?? ''}>{d.entity_name ?? 'Campanha'}</h3>
          {isAdLevel && (adCampaignName || adItemMlb) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
              {adCampaignName && (
                <span className="inline-flex items-center gap-1 truncate" title={adCampaignName}>
                  <Layers className="h-3 w-3 shrink-0 opacity-70" />
                  <span className="truncate">{adCampaignName}</span>
                </span>
              )}
              {adCampaignName && adItemMlb && <span className="opacity-40">·</span>}
              {adItemMlb && <span className="font-mono tabular-nums text-muted-foreground/90">{adItemMlb}</span>}
            </div>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-foreground/80">{d.rationale}</p>

      {signalChips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {signalChips.map(([k, v]) => (
            <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {k}: {typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v)}
            </span>
          ))}
        </div>
      )}

      {/* antes → depois */}
      <div className="mt-3 rounded-lg border border-border bg-background/40 p-2.5">
        {isAdLevel ? (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Anúncio</span>
            <span className="tabular-nums">
              {d.before?.status ? (
                <span className="text-muted-foreground">{String(d.before.status)}</span>
              ) : null}
              <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground" />
              <span className={cn('font-semibold', tn.text)}>
                {d.type === 'pause_ad' ? 'pausar' : d.type === 'remove_ad' ? 'remover' : 'impulsionar'}
              </span>
            </span>
          </div>
        ) : isBudget ? (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Orçamento</span>
              <span className="tabular-nums">
                <span className="text-muted-foreground line-through">{brlFromCents(beforeCents)}</span>
                <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground" />
                <span className={cn('font-semibold', tn.text)}>{isPending ? brl(edited) : brlFromCents(afterCents)}</span>
                <span className="ml-1 text-[10px] text-muted-foreground">/dia</span>
              </span>
            </div>
            {isPending && (
              <>
                <input
                  type="range" min={minB} max={maxB} step={1} value={edited}
                  onChange={(e) => setEdited(Number(e.target.value))}
                  className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-cyan-400"
                />
                <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground tabular-nums">
                  <span>{brl(minB)}</span><span>arraste p/ ajustar (±20%)</span><span>{brl(maxB)}</span>
                </div>
              </>
            )}
          </>
        ) : statusAfter ? (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Status</span>
            <span className="tabular-nums">
              <span className="text-muted-foreground">{String(d.before?.status ?? '—')}</span>
              <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground" />
              <span className={cn('font-semibold', tn.text)}>{statusAfter}</span>
            </span>
          </div>
        ) : acosAfter != null ? (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{isMl ? 'ROAS Objetivo' : 'ACOS-alvo'}</span>
            <span className="tabular-nums">
              {isMl ? (
                <>
                  {roasBefore != null && (
                    <>
                      <span className="text-muted-foreground line-through">{roasBefore}×</span>
                      <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground" />
                    </>
                  )}
                  <span className={cn('font-semibold', tn.text)}>{roasAfter}×</span>
                  <span className="ml-1 text-[10px] text-muted-foreground">(ACOS {acosAfter}%)</span>
                </>
              ) : (
                <>
                  {acosBefore != null && (
                    <>
                      <span className="text-muted-foreground line-through">{acosBefore}%</span>
                      <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground" />
                    </>
                  )}
                  <span className={cn('font-semibold', tn.text)}>{acosAfter}%</span>
                </>
              )}
            </span>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Ação sem mudança de orçamento.</div>
        )}
      </div>

      <div className="mt-3"><ConfidenceBar value={d.confidence} /></div>

      {isPending ? (
        isMl ? (
          <div className="mt-3">
            <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-200">
              <span className="font-semibold text-amber-300">Mercado Livre · ajuste manual</span> — a aplicação automática aguarda liberação de escrita do Mercado Ads. Por ora:
              <span className="mt-1 block font-medium">{mlInstruction}</span>
              {adPermalink && (
                <a
                  href={adPermalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 font-medium text-cyan-300 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> ver anúncio
                </a>
              )}
            </div>
            <div className="flex gap-2">
              <a
                href={mlCampaignUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Abrir no Mercado Ads
              </a>
              <button
                onClick={() => onDecide(d.id, 'reject')}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" /> Dispensar
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onDecide(d.id, 'approve', isBudget && edited !== Math.round((afterCents ?? 0) / 100) ? edited : undefined)}
              disabled={busy}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" /> Aprovar e aplicar
            </button>
            <button
              onClick={() => onDecide(d.id, 'reject')}
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
            >
              <X className="h-3.5 w-3.5" /> Rejeitar
            </button>
          </div>
        )
      ) : d.status === 'applied' ? (
        <div className="mt-3 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-300">
            <Check className="h-3 w-3" /> Aplicada
          </span>
          {d.outcome_verdict && (
            <span className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium',
              d.outcome_verdict === 'positive' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : d.outcome_verdict === 'negative' ? 'border-red-500/30 bg-red-500/10 text-red-300'
                  : 'border-border bg-muted text-muted-foreground')}
              title="Resultado medido 72h após aplicar">
              {d.outcome_verdict === 'positive' ? '✓ funcionou' : d.outcome_verdict === 'negative' ? '✗ piorou' : '~ neutro'}
            </span>
          )}
          <button
            onClick={() => onRollback(d.id)}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-amber-500/10 hover:text-amber-300 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reverter
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <span className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium',
            d.status === 'rejected' ? 'border-border bg-muted text-muted-foreground'
              : d.status === 'failed' ? 'border-red-500/30 bg-red-500/10 text-red-300'
                : 'border-border bg-muted text-muted-foreground')}>
            {d.status === 'rejected' ? 'Rejeitada' : d.status === 'failed' ? 'Falhou' : d.status === 'rolled_back' ? 'Revertida' : d.status}
          </span>
        </div>
      )}
    </div>
  );
}

function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case 'active': return { label: 'ativa', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' };
    case 'paused': return { label: 'pausada', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' };
    case 'error': return { label: 'erro', cls: 'border-red-500/30 bg-red-500/10 text-red-300' };
    default: return { label: status, cls: 'border-border bg-muted text-muted-foreground' };
  }
}
const TIER_LABEL: Record<string, string> = { low: 'baixo', standard: 'padrão', high: 'alto' };

function AccountCard({ a, busy, selected, onAction, onOpen, onSetMode }: {
  a: AccountOverview; busy: Record<string, boolean>; selected: boolean;
  onAction: (id: string, action: 'sync' | 'analyze' | 'toggle', acc: AccountOverview) => void;
  onOpen: () => void;
  onSetMode: (id: string, mode: 'copilot' | 'auto') => void;
}) {
  const sp = statusPill(a.status);
  return (
    <div className={cn('rounded-xl border bg-card p-4 transition-colors', selected ? 'border-primary/50' : 'border-border hover:border-primary/30')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold" title={a.name ?? ''}>{a.name ?? 'Conta'}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">{a.platform}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className={cn('rounded-full border px-1.5 py-0.5 font-medium', sp.cls)}>{sp.label}</span>
            <span>tier {TIER_LABEL[a.spend_tier] ?? a.spend_tier}</span>
            <span>· coleta {relTime(a.last_polled_at)}</span>
          </div>
        </div>
        <button
          onClick={() => onAction(a.id, 'toggle', a)}
          disabled={busy[`toggle:${a.id}`]}
          title={a.status === 'active' ? 'Pausar no motor (kill-switch)' : 'Reativar no motor'}
          className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-40',
            a.status === 'active' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-red-500/10 hover:text-red-300' : 'border-border bg-card text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-300')}
        >
          <Power className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-background/40 p-0.5 text-[11px]">
          {(['copilot', 'auto'] as const).map((m) => (
            <button
              key={m}
              onClick={() => a.decision_mode !== m && onSetMode(a.id, m)}
              disabled={busy[`mode:${a.id}`]}
              className={cn('rounded-md px-2 py-0.5 font-medium transition-colors disabled:opacity-40',
                a.decision_mode === m
                  ? m === 'auto' ? 'bg-amber-500/20 text-amber-300' : 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground')}
            >
              {m === 'copilot' ? 'Copiloto' : '⚡ Auto'}
            </button>
          ))}
        </div>
        {a.decision_mode === 'auto' && (
          <span className="text-[10px] text-amber-300/80">aplica proteção sozinho</span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <Mini label="Gasto 7d" value={brlFromCents(a.spend_cents)} />
        <Mini label="Result." value={num(a.results)} />
        <Mini label="Custo/r" value={brlFromCents(a.cost_per_result_cents)} />
        <Mini label="Camp." value={`${a.active_campaigns}/${a.campaigns}`} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button onClick={() => onAction(a.id, 'sync', a)} disabled={busy[`sync:${a.id}`]}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-muted/40 disabled:opacity-40">
          <RefreshCw className={cn('h-3 w-3', busy[`sync:${a.id}`] && 'animate-spin')} /> Sync
        </button>
        <button onClick={() => onAction(a.id, 'analyze', a)} disabled={busy[`analyze:${a.id}`]}
          className="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-40">
          <Sparkles className={cn('h-3 w-3', busy[`analyze:${a.id}`] && 'animate-pulse')} /> Analisar
        </button>
        <button onClick={onOpen}
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-primary">
          {selected ? 'Fechar' : 'Campanhas'} <ChevronRight className={cn('h-3 w-3 transition-transform', selected && 'rotate-90')} />
        </button>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/40 py-1.5">
      <div className="text-sm font-semibold tabular-nums leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function TrendArrow({ c }: { c: CampaignDossier['trend'] }) {
  if (c.label === 'improving') return <span className="inline-flex items-center gap-0.5 text-emerald-300"><TrendingUp className="h-3 w-3" />{c.roas_change_pct != null ? `${c.roas_change_pct > 0 ? '+' : ''}${c.roas_change_pct.toFixed(0)}%` : ''}</span>;
  if (c.label === 'declining') return <span className="inline-flex items-center gap-0.5 text-red-300"><TrendingDown className="h-3 w-3" />{c.roas_change_pct != null ? `${c.roas_change_pct.toFixed(0)}%` : ''}</span>;
  if (c.label === 'insufficient') return <span className="text-muted-foreground/50">—</span>;
  return <span className="inline-flex items-center text-muted-foreground"><Minus className="h-3 w-3" /></span>;
}

function CampaignsTable({ data, loading }: { data: AccountCampaigns | null; loading: boolean }) {
  if (loading) return <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Carregando campanhas…</div>;
  if (!data || data.entities.length === 0)
    return <div className="rounded-xl border border-dashed border-border bg-muted/10 p-8 text-center text-sm text-muted-foreground">Sem campanhas com dados nesta conta.</div>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-xs">
        <thead className="sticky top-0 border-b border-border bg-card text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Campanha</th>
            <th className="px-3 py-2 text-left font-medium">Objetivo</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Orç./dia</th>
            <th className="px-3 py-2 text-right font-medium">Gasto</th>
            <th className="px-3 py-2 text-right font-medium">Result.</th>
            <th className="px-3 py-2 text-right font-medium">Custo/r</th>
            <th className="px-3 py-2 text-right font-medium">ROAS</th>
            <th className="px-3 py-2 text-right font-medium">CTR</th>
            <th className="px-3 py-2 text-right font-medium">Freq.</th>
            <th className="px-3 py-2 text-right font-medium">Tend.</th>
          </tr>
        </thead>
        <tbody>
          {data.entities.map((c) => {
            const sp = statusPill(c.status);
            return (
              <tr key={c.external_id} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                <td className="max-w-[220px] truncate px-3 py-2 font-medium" title={c.name ?? ''}>{c.name ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{c.objective ?? '—'}</td>
                <td className="px-3 py-2"><span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] font-medium', sp.cls)}>{sp.label}</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{brl(c.budget_brl)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{brl(c.window.spend_brl)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{num(c.window.conversions)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{brl(c.averages.cpa_brl)}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', c.averages.roas != null && (c.averages.roas >= 1 ? 'text-emerald-300' : c.averages.roas > 0 ? 'text-amber-300' : ''))}>{x(c.averages.roas)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(c.averages.ctr_pct)}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', c.averages.avg_frequency != null && c.averages.avg_frequency > 3 && 'text-amber-300')}>{c.averages.avg_frequency != null ? c.averages.avg_frequency.toFixed(1) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums"><TrendArrow c={c.trend} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ enrollable, onEnroll, busy }: {
  enrollable: EnrollableIntegration[];
  onEnroll: (id: string) => void; busy: Record<string, boolean>;
}) {
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/30">
        <Gauge className="h-7 w-7" />
      </div>
      <h2 className="text-base font-semibold">Conecte uma conta ao motor</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Matricule uma conta de anúncios já conectada e o piloto começa a coletar, analisar e sugerir otimizações sozinho.
      </p>
      {enrollable.length > 0 ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {enrollable.map((i) => (
            <button key={i.id} onClick={() => onEnroll(i.id)} disabled={busy[`enroll:${i.id}`]}
              className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-40">
              <Plus className="mr-1 inline h-3 w-3" /> {i.account_name ?? i.ad_account_id}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Nenhuma integração Meta ativa encontrada. Conecte uma conta em Configurações → Integrações primeiro.
        </p>
      )}
    </div>
  );
}

function SkeletonBoard() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-[88px] animate-pulse rounded-xl border border-border bg-card" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-44 animate-pulse rounded-xl border border-border bg-card" />
        ))}
      </div>
    </div>
  );
}
