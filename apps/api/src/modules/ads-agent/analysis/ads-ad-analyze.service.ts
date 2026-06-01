import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { AdsAccountsService } from '../ads-accounts.service';
import type { DecisionType, EntityStatus } from '../contracts/ad-provider';

/**
 * Análise de NÍVEL-ANÚNCIO do Mercado Livre (F12 ML Fase 4 — COPILOTO).
 *
 * O motor base (AdsAnalyzeService) decide no nível de CAMPANHA via LLM. Aqui o
 * grão é o ANÚNCIO (item do Product Ads). Os sinais são mecânicos e crus (gasto,
 * vendas, ACOS vs margem, status, recommended), então a heurística é
 * DETERMINÍSTICA — mais confiável e barata que LLM, e fácil de auditar.
 *
 * Duas decisões:
 *   • pause_ad / remove_ad — anúncio ATIVO dentro de campanha gastando sem
 *     retorno (gasto material + ~zero vendas, ou ACOS muito acima da margem).
 *   • boost_ad — item RECOMENDADO pelo ML (ou idle) que NÃO está rodando →
 *     candidato a impulsionar.
 *
 * ⛔ É SEMPRE copiloto: a escrita no Product Ads do ML está bloqueada (401
 * mclics). Cada decisão vira card + deep-link pro painel; nada é aplicado.
 *
 * Fonte: view-ponte active.v_saas_ml_ads_items (snapshot por anúncio que o SaaS
 * coleta no sync). Grava ads_entities level='ad' SÓ pros anúncios sinalizados
 * (poucos) — não infla o schema com os milhares de itens do catálogo.
 */
@Injectable()
export class AdsAdAnalyzeService {
  private readonly logger = new Logger(AdsAdAnalyzeService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly accounts: AdsAccountsService,
  ) {}

  async analyzeAccount(accountId: string): Promise<AdAnalyzeResult> {
    const base: AdAnalyzeResult = { account_id: accountId, proposed: 0, persisted: 0, skipped: 0 };

    const acct = await this.accounts.getInternal(accountId);
    if (!acct) return { ...base, reason: 'conta não encontrada' };
    if (acct.status !== 'active') return { ...base, reason: `conta ${acct.status}` };
    // Nível-anúncio hoje é só Mercado Livre (única plataforma com snapshot de ad).
    if (acct.platform !== 'mercadolivre') return { ...base, reason: 'sem nível-anúncio p/ a plataforma' };

    const items = await this.loadItems(acct.credential_ref, acct.external_account_id);
    if (items.length === 0) return { ...base, reason: 'sem anúncios sincronizados' };

    const marginCeil = await this.getMarginCeiling(acct.credential_ref).catch(() => DEFAULT_MARGIN_CEILING);

    // 1. avalia cada anúncio
    const flagged: Array<{ item: AdItem; dec: AdDecision }> = [];
    for (const item of items) {
      const dec = evaluate(item, marginCeil);
      if (dec && dec.confidence >= MIN_CONFIDENCE) flagged.push({ item, dec });
    }
    base.proposed = flagged.length;
    if (flagged.length === 0) return base;

    // 2. caps por tipo (anti-flood na 1ª passada; dedup cobre as próximas)
    const pauses = flagged
      .filter((f) => f.dec.type === 'pause_ad' || f.dec.type === 'remove_ad')
      .sort((a, b) => b.dec.priority - a.dec.priority)
      .slice(0, MAX_PAUSE_PER_RUN);
    const boosts = flagged
      .filter((f) => f.dec.type === 'boost_ad')
      .sort((a, b) => b.dec.priority - a.dec.priority)
      .slice(0, MAX_BOOST_PER_RUN);
    const selected = [...pauses, ...boosts];

    // 3. materializa as entidades de anúncio (só as sinalizadas) → entity_id
    const entityIdByItem = await this.upsertAdEntities(acct.org_id, accountId, selected.map((s) => s.item));
    const pendingKeys = await this.loadPendingKeys(accountId);

    for (const { item, dec } of selected) {
      const entityId = entityIdByItem.get(item.item_id);
      if (!entityId) { base.skipped += 1; continue; }
      const key = `${entityId}:${dec.type}`;
      if (pendingKeys.has(key)) { base.skipped += 1; continue; } // dedup

      const ok = await this.insertDecision(acct.org_id, accountId, entityId, item, dec, marginCeil);
      if (!ok) { base.skipped += 1; continue; }
      pendingKeys.add(key);
      base.persisted += 1;
    }

    this.logger.log(
      `ad-analyze[${accountId}] anúncios=${items.length} propostas=${base.proposed} gravadas=${base.persisted} puladas=${base.skipped}`,
    );
    return base;
  }

  // ── dados ──────────────────────────────────────────────────

  private async loadItems(saasOrgId: string, advertiserId: string): Promise<AdItem[]> {
    const { data, error } = await this.supabase.adminClient
      .from('v_saas_ml_ads_items')
      .select(
        'item_id, advertiser_id, campaign_id, title, price, permalink, status, recommended, clicks, prints, cost, units_quantity, total_amount, acos, roas, metrics_days',
      )
      .eq('organization_id', saasOrgId)
      .eq('advertiser_id', advertiserId);
    if (error) {
      this.logger.warn(`loadItems falhou: ${error.message}`);
      return [];
    }
    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
      item_id: String(r.item_id),
      campaign_id: r.campaign_id != null ? String(r.campaign_id) : null,
      title: (r.title as string | null) ?? null,
      price: toNum(r.price),
      permalink: (r.permalink as string | null) ?? null,
      status: ((r.status as string | null) ?? '').toLowerCase(),
      recommended: r.recommended === true,
      clicks: toNum(r.clicks) ?? 0,
      prints: toNum(r.prints) ?? 0,
      cost: toNum(r.cost) ?? 0,
      units_quantity: toNum(r.units_quantity) ?? 0,
      total_amount: toNum(r.total_amount) ?? 0,
      acos: toNum(r.acos) ?? 0,
      roas: toNum(r.roas) ?? 0,
      metrics_days: toNum(r.metrics_days) ?? 30,
    }));
  }

  /**
   * Teto de ACOS da org = margem de contribuição REAL (DRE blended 60d, ponte
   * v_saas_org_margins). Fallback: min_campaign_margin_pct (public). Sem nada →
   * teto conservador DEFAULT_MARGIN_CEILING. Mesma fonte do especialista ML de
   * campanha — financeiro real guia o anúncio.
   */
  private async getMarginCeiling(saasOrgId: string): Promise<number> {
    const { data: m } = await this.supabase.adminClient
      .from('v_saas_org_margins')
      .select('contribution_margin_pct')
      .eq('organization_id', saasOrgId)
      .maybeSingle();
    const real = (m as { contribution_margin_pct: number | null } | null)?.contribution_margin_pct;
    if (typeof real === 'number' && real > 0) return real;

    const { data } = await this.supabase.adminClient
      .schema('public')
      .from('organizations')
      .select('min_campaign_margin_pct')
      .eq('id', saasOrgId)
      .maybeSingle();
    const v = (data as { min_campaign_margin_pct: number | null } | null)?.min_campaign_margin_pct;
    return typeof v === 'number' && v > 0 ? v : DEFAULT_MARGIN_CEILING;
  }

  /** Materializa (idempotente) ads_entities level='ad' pros anúncios sinalizados. */
  private async upsertAdEntities(
    orgId: string,
    accountId: string,
    items: AdItem[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (items.length === 0) return map;
    const rows = items.map((it) => ({
      org_id: orgId,
      account_id: accountId,
      level: 'ad' as const,
      platform: 'mercadolivre',
      external_id: it.item_id,
      name: it.title,
      objective: 'catalog_sales',
      status: normalizeAdStatus(it.status),
      budget_cents: null,
      budget_type: null,
      raw: it as unknown as Record<string, unknown>,
      synced_at: new Date().toISOString(),
    }));
    const { data, error } = await this.supabase.adminClient
      .from('ads_entities')
      .upsert(rows, { onConflict: 'account_id,external_id' })
      .select('id, external_id');
    if (error) {
      this.logger.warn(`upsertAdEntities falhou: ${error.message}`);
      return map;
    }
    for (const r of (data ?? []) as Array<{ id: string; external_id: string }>) {
      map.set(r.external_id, r.id);
    }
    return map;
  }

  private async loadPendingKeys(accountId: string): Promise<Set<string>> {
    const { data } = await this.supabase.adminClient
      .from('ads_decisions')
      .select('entity_id, type')
      .eq('account_id', accountId)
      .eq('status', 'pending');
    const set = new Set<string>();
    for (const r of (data ?? []) as Array<{ entity_id: string; type: string }>) {
      set.add(`${r.entity_id}:${r.type}`);
    }
    return set;
  }

  private async insertDecision(
    orgId: string,
    accountId: string,
    entityId: string,
    item: AdItem,
    dec: AdDecision,
    marginCeil: number,
  ): Promise<boolean> {
    // before carrega o contexto do anúncio (a campanha-pai + link público) — o
    // card usa pra montar o deep-link certo e o link do anúncio.
    const before: Record<string, unknown> = {
      status: item.status,
      item_id: item.item_id,
      campaign_id: item.campaign_id,
      permalink: item.permalink,
      title: item.title,
      price: item.price,
    };
    const after: Record<string, unknown> = {
      ad_action: dec.type === 'remove_ad' ? 'remove' : dec.type === 'boost_ad' ? 'boost' : 'pause',
    };
    const { error } = await this.supabase.adminClient.from('ads_decisions').insert({
      org_id: orgId,
      entity_id: entityId,
      account_id: accountId,
      type: dec.type,
      rationale: dec.rationale.slice(0, 1000),
      signals: dec.signals,
      before,
      after,
      confidence: Math.min(Math.max(dec.confidence, 0), 1),
      mode: 'copilot',
      status: 'pending',
    });
    if (error) {
      this.logger.warn(`insertDecision falhou (${item.item_id}): ${error.message}`);
      return false;
    }
    return true;
  }
}

// ════════════════════════════════════════════
// Heurística determinística
// ════════════════════════════════════════════

export interface AdAnalyzeResult {
  account_id: string;
  proposed: number;
  persisted: number;
  skipped: number;
  reason?: string;
}

interface AdItem {
  item_id: string;
  campaign_id: string | null;
  title: string | null;
  price: number | null;
  permalink: string | null;
  status: string; // ML: active|paused|hold|idle...
  recommended: boolean;
  clicks: number;
  prints: number;
  cost: number;
  units_quantity: number;
  total_amount: number;
  acos: number;
  roas: number;
  metrics_days: number;
}

interface AdDecision {
  type: DecisionType;
  confidence: number;
  priority: number; // ordenação p/ o cap por tipo
  rationale: string;
  signals: Record<string, unknown>;
}

/** Confiança mínima pra uma sugestão de anúncio entrar na fila. */
const MIN_CONFIDENCE = 0.55;
/** Gasto material (R$) na janela p/ considerar pausar um anúncio. */
const MIN_SPEND_PAUSE = 15;
/** Gasto alto (R$) + ZERO vendas → remover (sinal mais forte que pausar). */
const REMOVE_SPEND = 50;
/** ACOS acima de margem×fator (com vendas) = prejuízo sustentado → pausar. */
const ACOS_PAUSE_FACTOR = 2.0;
/** Teto de ACOS padrão quando a margem da org não veio. */
const DEFAULT_MARGIN_CEILING = 25;
const MAX_PAUSE_PER_RUN = 10;
const MAX_BOOST_PER_RUN = 5;

const r2 = (n: number): number => Math.round(n * 100) / 100;
const brl = (n: number): string => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Avalia UM anúncio → decisão (ou null). Conservador: na dúvida, não age. */
function evaluate(it: AdItem, marginCeil: number): AdDecision | null {
  const days = it.metrics_days || 30;

  // ── PAUSAR / REMOVER: anúncio ATIVO gastando sem retorno ──
  if (it.status === 'active' && it.cost >= MIN_SPEND_PAUSE) {
    if (it.units_quantity === 0) {
      // gastou material com ZERO vendas na janela
      const type: DecisionType = it.cost >= REMOVE_SPEND ? 'remove_ad' : 'pause_ad';
      const confidence = clamp(0.6 + Math.min(it.cost / 200, 0.3), 0.6, 0.92);
      const verb = type === 'remove_ad' ? 'remover da campanha' : 'pausar o anúncio';
      return {
        type,
        confidence,
        priority: 1000 + it.cost,
        rationale: `Anúncio "${title(it)}" gastou ${brl(it.cost)} em ${days}d com ZERO vendas (${it.clicks} cliques). Sugiro ${verb} — está consumindo verba sem converter.`,
        signals: {
          gasto_brl: r2(it.cost),
          vendas: it.units_quantity,
          cliques: it.clicks,
          impressoes: it.prints,
          margem_alvo_pct: r2(marginCeil),
        },
      };
    }
    if (it.acos > 0 && it.acos > marginCeil * ACOS_PAUSE_FACTOR) {
      // vende, mas ACOS MUITO acima da margem (≥2×) → prejuízo sustentado
      const over = (it.acos - marginCeil) / marginCeil;
      const confidence = clamp(0.55 + Math.min(over * 0.25, 0.3), 0.55, 0.85);
      return {
        type: 'pause_ad',
        confidence,
        priority: 500 + it.acos,
        rationale: `Anúncio "${title(it)}" tem ACOS ${r2(it.acos)}% — mais que o dobro da margem-alvo (${r2(marginCeil)}%). Cada venda dá prejuízo; sugiro pausar este anúncio na campanha.`,
        signals: {
          acos_pct: r2(it.acos),
          margem_alvo_pct: r2(marginCeil),
          gasto_brl: r2(it.cost),
          vendas: it.units_quantity,
        },
      };
    }
  }

  // ── IMPULSIONAR: item recomendado pelo ML, mas NÃO está rodando ──
  // hold = sem estoque a nível marketplace → não impulsionar.
  if (it.recommended && it.status !== 'active' && it.status !== 'hold') {
    return {
      type: 'boost_ad',
      confidence: 0.6,
      priority: 100 + (it.total_amount || it.price || 0),
      rationale: `Item "${title(it)}" é recomendado pelo Mercado Livre (bom rendimento esperado), mas ${it.status === 'idle' ? 'NÃO está em campanha' : 'está pausado'}. Bom candidato a impulsionar${it.price ? ` (preço ${brl(it.price)}` : ''}${it.price ? `, margem-alvo ${r2(marginCeil)}%)` : ` (margem-alvo ${r2(marginCeil)}%)`}.`,
      signals: {
        recomendado_ml: true,
        status_ml: it.status,
        preco_brl: it.price != null ? r2(it.price) : null,
        receita_hist_brl: r2(it.total_amount),
      },
    };
  }
  // idle puro (item fora de campanha) — impulsionar mesmo sem recommended.
  if (it.status === 'idle') {
    return {
      type: 'boost_ad',
      confidence: 0.56,
      priority: it.price ?? 0,
      rationale: `Item "${title(it)}" está disponível mas FORA de campanha (idle). Considere incluí-lo em uma campanha de Product Ads${it.price ? ` — preço ${brl(it.price)}` : ''} (margem-alvo ${r2(marginCeil)}%).`,
      signals: {
        status_ml: it.status,
        preco_brl: it.price != null ? r2(it.price) : null,
        margem_alvo_pct: r2(marginCeil),
      },
    };
  }

  return null;
}

function title(it: AdItem): string {
  const t = (it.title ?? '').trim();
  if (t) return t.length > 60 ? `${t.slice(0, 57)}…` : t;
  return it.item_id;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function normalizeAdStatus(status: string): EntityStatus {
  switch (status) {
    case 'active':
      return 'active';
    case 'paused':
    case 'idle':
      return 'paused';
    case 'hold':
    case 'revoked':
    case 'delegated':
    case 'deleted':
      return 'archived';
    default:
      return 'paused';
  }
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
