import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { AdProviderDispatcher } from './ad-provider.dispatcher';
import { AdsAccountsService } from './ads-accounts.service';
import type { DecisionType, ProviderDecision } from './contracts/ad-provider';

interface DecisionFull {
  id: string;
  org_id: string;
  entity_id: string;
  account_id: string;
  type: DecisionType;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  status: string;
}

/** Janela default de medição de outcome após aplicar (MVP-3b mede). */
const MEASURE_AFTER_HOURS = 72;
/** Teto de variação re-checado no apply (mesmo do playbook). */
const MAX_BUDGET_CHANGE_PCT = 0.2;

/**
 * Executa decisões aprovadas no provider (aplicação REAL) e faz rollback.
 *
 * Guardrails no momento do apply (defesa em profundidade — além do clamp na
 * criação): conta precisa estar ATIVA (kill-switch), decisão precisa estar
 * pendente, e variação de orçamento re-validada em ±20%. Toda ação guarda o
 * `before` → rollback reverte em 1 clique.
 */
@Injectable()
export class AdsApplyService {
  private readonly logger = new Logger(AdsApplyService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: AdProviderDispatcher,
    private readonly accounts: AdsAccountsService,
  ) {}

  /** Aprova + APLICA de verdade. Chamado pelo botão "Aprovar". */
  async apply(orgId: string, decisionId: string): Promise<{ id: string; status: string; message: string }> {
    const dec = await this.load(orgId, decisionId);
    if (dec.status !== 'pending') {
      throw new BadRequestException(
        `Decisão com status "${dec.status}" — só pendentes podem ser aplicadas.`,
      );
    }

    // kill-switch: conta precisa estar ativa no motor
    const acctRow = await this.accounts.getInternal(dec.account_id);
    if (!acctRow) throw new NotFoundException('Conta da decisão não encontrada.');
    if (acctRow.status !== 'active') {
      throw new BadRequestException(
        `Conta "${acctRow.name ?? acctRow.external_account_id}" está ${acctRow.status} no motor — reative antes de aplicar.`,
      );
    }

    // re-guard de orçamento (±20%)
    this.assertBudgetWithinBounds(dec.type, dec.before, dec.after);

    const externalId = await this.entityExternalId(dec.entity_id);
    if (!externalId) throw new NotFoundException('Entidade da decisão não encontrada.');

    const pd: ProviderDecision = {
      account: this.accounts.toAdAccount(acctRow),
      type: dec.type,
      entityExternalId: externalId,
      level: 'campaign',
      before: dec.before,
      after: dec.after,
    };

    const provider = this.dispatcher.resolve(acctRow.platform);
    const result = await provider.applyAction(pd);

    if (!result.ok) {
      await this.update(decisionId, {
        status: 'failed',
        error_message: (result.message ?? 'Falha ao aplicar').slice(0, 500),
      });
      throw new BadRequestException(result.message ?? 'Falha ao aplicar a ação no provedor.');
    }

    const measureAfter = new Date(Date.now() + MEASURE_AFTER_HOURS * 3600_000).toISOString();
    await this.update(decisionId, {
      status: 'applied',
      applied_at: new Date().toISOString(),
      measure_after: measureAfter,
      error_message: null,
    });
    this.logger.log(`apply[${decisionId}] ${dec.type} OK — ${result.message ?? ''}`);
    return { id: decisionId, status: 'applied', message: result.message ?? 'Aplicado.' };
  }

  /** Reverte uma decisão já aplicada (volta ao estado `before`). */
  async rollback(orgId: string, decisionId: string): Promise<{ id: string; status: string; message: string }> {
    const dec = await this.load(orgId, decisionId);
    if (dec.status !== 'applied') {
      throw new BadRequestException(
        `Só dá pra reverter decisões aplicadas (status atual: "${dec.status}").`,
      );
    }
    const acctRow = await this.accounts.getInternal(dec.account_id);
    if (!acctRow) throw new NotFoundException('Conta da decisão não encontrada.');

    const externalId = await this.entityExternalId(dec.entity_id);
    if (!externalId) throw new NotFoundException('Entidade da decisão não encontrada.');

    // reverso: troca before↔after; pause↔activate
    const reverseType = this.reverseType(dec.type);
    const pd: ProviderDecision = {
      account: this.accounts.toAdAccount(acctRow),
      type: reverseType,
      entityExternalId: externalId,
      level: 'campaign',
      before: dec.after, // estado atual (pós-apply)
      after: dec.before, // alvo do rollback
    };

    const provider = this.dispatcher.resolve(acctRow.platform);
    const result = await provider.applyAction(pd);
    if (!result.ok) {
      throw new BadRequestException(result.message ?? 'Falha ao reverter.');
    }
    await this.update(decisionId, { status: 'rolled_back' });
    this.logger.log(`rollback[${decisionId}] OK`);
    return { id: decisionId, status: 'rolled_back', message: 'Revertido ao estado anterior.' };
  }

  // ── internals ──────────────────────────────────────────────

  private reverseType(type: DecisionType): DecisionType {
    if (type === 'pause') return 'activate';
    if (type === 'activate') return 'pause';
    if (type === 'scale_budget') return 'reduce_budget';
    if (type === 'reduce_budget') return 'scale_budget';
    return type; // reallocate/adjust_bid: reverso ainda é budget swap
  }

  private assertBudgetWithinBounds(
    type: DecisionType,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): void {
    if (type !== 'scale_budget' && type !== 'reduce_budget' && type !== 'reallocate') return;
    const b = typeof before.budget_cents === 'number' ? before.budget_cents : null;
    const a = typeof after.budget_cents === 'number' ? after.budget_cents : null;
    if (b == null || a == null || b <= 0) return; // applyAction barra depois
    const change = Math.abs(a - b) / b;
    if (change > MAX_BUDGET_CHANGE_PCT + 0.001) {
      throw new BadRequestException(
        `Variação de orçamento ${(change * 100).toFixed(0)}% excede o teto de ${MAX_BUDGET_CHANGE_PCT * 100}% por ciclo.`,
      );
    }
  }

  private async load(orgId: string, id: string): Promise<DecisionFull> {
    const { data, error } = await this.supabase.adminClient
      .from('ads_decisions')
      .select('id, org_id, entity_id, account_id, type, before, after, status')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Decisão não encontrada.');
    return data as unknown as DecisionFull;
  }

  private async entityExternalId(entityId: string): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('ads_entities')
      .select('external_id')
      .eq('id', entityId)
      .maybeSingle();
    return (data as { external_id: string } | null)?.external_id ?? null;
  }

  private async update(id: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('ads_decisions')
      .update(patch)
      .eq('id', id);
    if (error) this.logger.warn(`update decision falhou: ${error.message}`);
  }
}
