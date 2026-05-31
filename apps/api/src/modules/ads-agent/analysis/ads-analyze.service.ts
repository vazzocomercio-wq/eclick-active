import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { LlmService } from '../../../common/llm/llm.service';
import { AdsAccountsService } from '../ads-accounts.service';
import { AdsApplyService } from '../ads-apply.service';
import { AdsKnowledgeService } from '../ads-knowledge.service';
import { AdsDossierService, EntityDossier } from './ads-dossier.service';
import {
  ADS_ANALYZE_SYSTEM,
  ANALYZE_MAX_TOKENS,
  ANALYZE_TEMPERATURE,
  AnalyzeOutput,
  knowledgeBlock,
  platformOverrideBlock,
  MAX_BUDGET_CHANGE_PCT,
  MIN_DATA_HOURS,
  MIN_DECISION_CONFIDENCE,
  ProposedDecision,
} from './ads-playbook';

export interface AnalyzeResult {
  account_id: string;
  proposed: number;
  persisted: number;
  skipped: number;
  auto_applied?: number;
  reason?: string;
}

interface RouteResult {
  persisted: boolean;
  decisionId?: string;
  autoEligible?: boolean;
}

interface EntityState {
  id: string;
  external_id: string;
  status: string;
  budget_cents: number | null;
  budget_type: string | null;
}

const BUDGET_FLOOR_CENTS = 100; // R$1/dia piso prático
const r2c = (reais: number): number => Math.round(reais * 100);

// ── modo auto (MVP-4) — conservador ────────────────────────
/** Confiança mínima pra auto-aplicar (sem humano). */
const AUTO_CONFIDENCE = 0.8;
/** SÓ ações de proteção/redução de custo aplicam sozinhas. Escalar = manual. */
const AUTO_TYPES = new Set(['reduce_budget', 'pause']);
/** Teto de auto-aplicações por ciclo de análise (anti-tempestade). */
const AUTO_MAX_PER_RUN = 2;

/**
 * ANALYZE + GUARD + ROUTE. Para uma conta:
 *   1. ENRICH    → dossiê (AdsDossierService)
 *   2. RETRIEVE  → KB vetorizada (vazia no MVP-2; MVP-3 popula)
 *   3. ANALYZE   → 1 call LlmService (json_mode) com o playbook → decisões propostas
 *   4. GUARD     → 48h de dados, teto ±20% orçamento, confiança mínima, dedup
 *   5. ROUTE     → grava ads_decisions mode=copilot status=pending (NÃO aplica)
 *
 * Copiloto: nunca executa. A aplicação real chega no MVP-3 (applyAction).
 */
@Injectable()
export class AdsAnalyzeService {
  private readonly logger = new Logger(AdsAnalyzeService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly accounts: AdsAccountsService,
    private readonly dossiers: AdsDossierService,
    private readonly llm: LlmService,
    private readonly knowledge: AdsKnowledgeService,
    private readonly applier: AdsApplyService,
  ) {}

  async analyzeAccount(accountId: string): Promise<AnalyzeResult> {
    const base: AnalyzeResult = { account_id: accountId, proposed: 0, persisted: 0, skipped: 0 };

    const acct = await this.accounts.getInternal(accountId);
    if (!acct) return { ...base, reason: 'conta não encontrada' };
    if (acct.status !== 'active') return { ...base, reason: `conta ${acct.status}` };

    const dossier = await this.dossiers.buildAccountDossier(accountId);
    if (!dossier || dossier.entities.length === 0) {
      return { ...base, reason: 'sem entidades' };
    }

    // GUARD pré-LLM: só manda quem tem ≥48h de dados (economiza token e evita ruído)
    const minDays = Math.ceil(MIN_DATA_HOURS / 24);
    const ready = dossier.entities.filter((e) => e.data_days >= minDays);
    if (ready.length === 0) {
      return { ...base, reason: `nenhuma campanha com ≥${MIN_DATA_HOURS}h de dados` };
    }

    // RETRIEVE — padrões aprendidos relevantes (RAG)
    const knowledge = await this.retrieveKnowledge(acct.org_id, acct.platform, ready);

    // Especialista por plataforma (ML = ACOS vs margem real da org)
    let marginPct: number | null = null;
    if (acct.platform === 'mercadolivre') {
      marginPct = await this.getMlMarginTarget(acct.credential_ref).catch(() => null);
    }
    const platformBlock = platformOverrideBlock(acct.platform, { marginTargetPct: marginPct });

    // ANALYZE
    let output: AnalyzeOutput;
    try {
      const res = await this.llm.chat({
        orgId: acct.org_id,
        feature: 'ads_agent_analyze',
        system: ADS_ANALYZE_SYSTEM + platformBlock + knowledgeBlock(knowledge),
        user: JSON.stringify({
          platform: dossier.platform,
          currency: dossier.currency,
          campaigns: ready,
        }),
        json_mode: true,
        max_tokens: ANALYZE_MAX_TOKENS,
        temperature: ANALYZE_TEMPERATURE,
      });
      output = this.parseOutput(res.text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`analyze[${accountId}] LLM falhou: ${msg}`);
      return { ...base, reason: `LLM: ${msg}` };
    }

    const proposals = Array.isArray(output.decisions) ? output.decisions : [];
    base.proposed = proposals.length;
    if (proposals.length === 0) return base;

    // Estados autoritativos das entidades (NÃO confiar no "before" do LLM)
    const stateByExt = await this.loadEntityStates(accountId);
    const pendingKeys = await this.loadPendingKeys(accountId);

    const autoMode = acct.decision_mode === 'auto';
    let autoApplied = 0;
    for (const p of proposals) {
      const res = await this.routeDecision(acct.org_id, accountId, p, stateByExt, pendingKeys, autoMode);
      if (!res.persisted) { base.skipped += 1; continue; }
      base.persisted += 1;
      // modo auto: aplica sozinho ações conservadoras de alta confiança (cap/ciclo)
      if (autoMode && res.autoEligible && res.decisionId && autoApplied < AUTO_MAX_PER_RUN) {
        try {
          await this.applier.apply(acct.org_id, res.decisionId);
          autoApplied += 1;
        } catch (err) {
          this.logger.warn(
            `auto-apply[${res.decisionId}] falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    base.auto_applied = autoApplied;

    this.logger.log(
      `analyze[${accountId}] propostas=${base.proposed} gravadas=${base.persisted} auto=${autoApplied} puladas=${base.skipped}`,
    );
    return base;
  }

  // ── GUARD + ROUTE de uma decisão ───────────────────────────

  private async routeDecision(
    orgId: string,
    accountId: string,
    p: ProposedDecision,
    stateByExt: Map<string, EntityState>,
    pendingKeys: Set<string>,
    autoMode: boolean,
  ): Promise<RouteResult> {
    if (typeof p.confidence !== 'number' || p.confidence < MIN_DECISION_CONFIDENCE) {
      return { persisted: false };
    }
    const state = stateByExt.get(p.entity_external_id);
    if (!state) return { persisted: false };

    const key = `${state.id}:${p.type}`;
    if (pendingKeys.has(key)) return { persisted: false }; // dedup: já tem pendente igual

    const before: Record<string, unknown> = {
      status: state.status,
      budget_cents: state.budget_cents,
      budget_type: state.budget_type,
    };
    let after: Record<string, unknown> | null = null;

    switch (p.type) {
      case 'scale_budget':
      case 'reduce_budget':
      case 'reallocate': {
        if (state.budget_cents == null || p.after_budget_brl == null) return { persisted: false };
        const proposedCents = r2c(p.after_budget_brl);
        const clamped = this.clampBudget(state.budget_cents, proposedCents, p.type);
        if (clamped == null || clamped === state.budget_cents) return { persisted: false };
        after = { budget_cents: clamped };
        if (p.type === 'reallocate' && p.reallocate_to_external_id) {
          after.reallocate_to_external_id = p.reallocate_to_external_id;
        }
        break;
      }
      case 'pause':
        if (state.status !== 'active') return { persisted: false };
        after = { status: 'paused' };
        break;
      case 'activate':
        if (state.status === 'active') return { persisted: false };
        after = { status: 'active' };
        break;
      case 'adjust_bid':
        // ML: ajuste de lance/ACOS-alvo. Aplicação real chega no apply do ML (Fase 3).
        after = { note: 'ajuste de lance/ACOS — sugestão (aplicação no provider em fase futura)' };
        break;
      default:
        return { persisted: false };
    }
    if (!after) return { persisted: false };

    // auto-elegível: conta em auto + alta confiança + ação conservadora
    const autoEligible = autoMode && p.confidence >= AUTO_CONFIDENCE && AUTO_TYPES.has(p.type);

    const { data, error } = await this.supabase.adminClient
      .from('ads_decisions')
      .insert({
        org_id: orgId,
        entity_id: state.id,
        account_id: accountId,
        type: p.type,
        rationale: (p.rationale ?? '').slice(0, 1000),
        signals: p.signals ?? {},
        before,
        after,
        confidence: Math.min(Math.max(p.confidence, 0), 1),
        mode: autoEligible ? 'auto' : 'copilot',
        status: 'pending',
      })
      .select('id')
      .single();
    if (error || !data) {
      this.logger.warn(`routeDecision insert falhou: ${error?.message}`);
      return { persisted: false };
    }
    pendingKeys.add(key);
    return { persisted: true, decisionId: (data as { id: string }).id, autoEligible };
  }

  /** Garante o teto de ±MAX_BUDGET_CHANGE_PCT e o piso de R$1/dia. */
  private clampBudget(
    beforeCents: number,
    proposedCents: number,
    type: ProposedDecision['type'],
  ): number | null {
    const maxUp = Math.round(beforeCents * (1 + MAX_BUDGET_CHANGE_PCT));
    const maxDown = Math.round(beforeCents * (1 - MAX_BUDGET_CHANGE_PCT));
    let after: number;
    if (type === 'scale_budget') {
      after = Math.min(Math.max(proposedCents, beforeCents), maxUp);
    } else {
      // reduce_budget / reallocate (corta a origem)
      after = Math.max(Math.min(proposedCents, beforeCents), maxDown);
    }
    after = Math.max(after, BUDGET_FLOOR_CENTS);
    return after;
  }

  // ── helpers de dados ───────────────────────────────────────

  private parseOutput(text: string): AnalyzeOutput {
    let raw = (text ?? '').trim();
    // tira cercas markdown se o modelo teimar
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    }
    const parsed = JSON.parse(raw) as AnalyzeOutput;
    return parsed;
  }

  private async loadEntityStates(accountId: string): Promise<Map<string, EntityState>> {
    const { data, error } = await this.supabase.adminClient
      .from('ads_entities')
      .select('id, external_id, status, budget_cents, budget_type')
      .eq('account_id', accountId)
      .eq('level', 'campaign');
    const map = new Map<string, EntityState>();
    if (error) {
      this.logger.warn(`loadEntityStates falhou: ${error.message}`);
      return map;
    }
    for (const r of (data ?? []) as unknown as EntityState[]) {
      map.set(r.external_id, r);
    }
    return map;
  }

  /**
   * Margem-alvo do ML (= teto de ACOS) da org. Financeiro Fase 4: usa a margem
   * de contribuição REAL (blended 60d, motor de DRE) via a ponte
   * `active.v_saas_org_margins` — fecha o loop "financeiro guia o anúncio".
   * Fallback: min_campaign_margin_pct estático (public.organizations).
   */
  private async getMlMarginTarget(saasOrgId: string): Promise<number | null> {
    // 1. margem de contribuição REAL (DRE / orders últimos 60d)
    const { data: m } = await this.supabase.adminClient
      .from('v_saas_org_margins')
      .select('contribution_margin_pct')
      .eq('organization_id', saasOrgId)
      .maybeSingle();
    const real = (m as { contribution_margin_pct: number | null } | null)?.contribution_margin_pct;
    if (typeof real === 'number' && real > 0) return real;

    // 2. fallback estático
    const { data } = await this.supabase.adminClient
      .schema('public')
      .from('organizations')
      .select('min_campaign_margin_pct')
      .eq('id', saasOrgId)
      .maybeSingle();
    const v = (data as { min_campaign_margin_pct: number | null } | null)?.min_campaign_margin_pct;
    return typeof v === 'number' ? v : null;
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

  /**
   * RETRIEVE — padrões aprendidos relevantes (RAG). Monta um resumo semântico
   * do dossiê (objetivos + tendências) e busca na KB vetorizada da org. Os
   * padrões voltam pro system prompt e SOBREPÕEM o playbook estático.
   * Best-effort: sem chave OpenAI / KB vazia → [].
   */
  private async retrieveKnowledge(
    orgId: string,
    platform: string,
    ready: EntityDossier[],
  ): Promise<string[]> {
    const objectives = Array.from(
      new Set(ready.map((e) => e.objective ?? 'geral')),
    ).slice(0, 6);
    const situations = ready
      .slice(0, 8)
      .map((e) => `${e.objective ?? 'geral'} tendência ${e.trend.label}`)
      .join('; ');
    const contextText = `Otimização de anúncios ${platform}. Objetivos: ${objectives.join(', ')}. Situações: ${situations}`;
    try {
      return await this.knowledge.retrieve(orgId, platform, contextText, 5);
    } catch {
      return [];
    }
  }
}
