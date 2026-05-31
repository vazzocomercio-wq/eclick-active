import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { LlmService } from '../../../common/llm/llm.service';
import { AdsAccountsService } from '../ads-accounts.service';
import { AdsDossierService } from './ads-dossier.service';
import {
  ADS_ANALYZE_SYSTEM,
  ANALYZE_MAX_TOKENS,
  ANALYZE_TEMPERATURE,
  AnalyzeOutput,
  knowledgeBlock,
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
  reason?: string;
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

    // RETRIEVE (MVP-3 popula a KB; por ora vazio)
    const knowledge = await this.retrieveKnowledge(acct.org_id, acct.platform);

    // ANALYZE
    let output: AnalyzeOutput;
    try {
      const res = await this.llm.chat({
        orgId: acct.org_id,
        feature: 'ads_agent_analyze',
        system: ADS_ANALYZE_SYSTEM + knowledgeBlock(knowledge),
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

    for (const p of proposals) {
      const persisted = await this.routeDecision(
        acct.org_id,
        accountId,
        p,
        stateByExt,
        pendingKeys,
      );
      if (persisted) base.persisted += 1;
      else base.skipped += 1;
    }

    this.logger.log(
      `analyze[${accountId}] propostas=${base.proposed} gravadas=${base.persisted} puladas=${base.skipped}`,
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
  ): Promise<boolean> {
    if (typeof p.confidence !== 'number' || p.confidence < MIN_DECISION_CONFIDENCE) {
      return false;
    }
    const state = stateByExt.get(p.entity_external_id);
    if (!state) return false;

    const key = `${state.id}:${p.type}`;
    if (pendingKeys.has(key)) return false; // dedup: já tem pendente igual

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
        if (state.budget_cents == null || p.after_budget_brl == null) return false;
        const proposedCents = r2c(p.after_budget_brl);
        const clamped = this.clampBudget(state.budget_cents, proposedCents, p.type);
        if (clamped == null || clamped === state.budget_cents) return false;
        after = { budget_cents: clamped };
        if (p.type === 'reallocate' && p.reallocate_to_external_id) {
          after.reallocate_to_external_id = p.reallocate_to_external_id;
        }
        break;
      }
      case 'pause':
        if (state.status !== 'active') return false;
        after = { status: 'paused' };
        break;
      case 'activate':
        if (state.status === 'active') return false;
        after = { status: 'active' };
        break;
      case 'adjust_bid':
        // MVP-2 não mexe em lance (precisa de adset/ad). Registra como nota.
        after = { note: 'adjust_bid requer nível adset (MVP futuro)' };
        break;
      default:
        return false;
    }
    if (!after) return false;

    const { error } = await this.supabase.adminClient.from('ads_decisions').insert({
      org_id: orgId,
      entity_id: state.id,
      account_id: accountId,
      type: p.type,
      rationale: (p.rationale ?? '').slice(0, 1000),
      signals: p.signals ?? {},
      before,
      after,
      confidence: Math.min(Math.max(p.confidence, 0), 1),
      mode: 'copilot',
      status: 'pending',
    });
    if (error) {
      this.logger.warn(`routeDecision insert falhou: ${error.message}`);
      return false;
    }
    pendingKeys.add(key);
    return true;
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
   * RETRIEVE — padrões aprendidos relevantes (RAG). No MVP-2 retorna [].
   * MVP-3: embedda o contexto e chama active.ads_knowledge_search.
   */
  private retrieveKnowledge(_orgId: string, _platform: string): Promise<string[]> {
    return Promise.resolve([]);
  }
}
