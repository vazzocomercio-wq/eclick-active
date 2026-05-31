import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';

export type DecisionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'failed'
  | 'rolled_back';

export interface DecisionRow {
  id: string;
  org_id: string;
  entity_id: string;
  account_id: string;
  type: string;
  rationale: string;
  signals: Record<string, unknown>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  confidence: number;
  mode: string;
  status: DecisionStatus;
  error_message: string | null;
  applied_at: string | null;
  created_at: string;
  // enriquecido:
  entity_name?: string | null;
  entity_external_id?: string | null;
}

const DECISION_COLS =
  'id, org_id, entity_id, account_id, type, rationale, signals, before, after, confidence, mode, status, error_message, applied_at, created_at';

/**
 * Fila de decisões do copiloto. MVP-2: listar + aprovar/rejeitar/editar.
 * "Aprovar" no MVP-2 só marca status=approved (intenção registrada) — a
 * aplicação real no provider chega no MVP-3 (applyAction + guardrails + rollback).
 */
@Injectable()
export class AdsDecisionsService {
  private readonly logger = new Logger(AdsDecisionsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(
    orgId: string,
    opts: { status?: DecisionStatus; limit?: number } = {},
  ): Promise<DecisionRow[]> {
    let q = this.supabase.adminClient
      .from('ads_decisions')
      .select(DECISION_COLS)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(Math.min(opts.limit ?? 100, 200));
    if (opts.status) q = q.eq('status', opts.status);

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(error.message);
    const rows = (data ?? []) as unknown as DecisionRow[];
    return this.enrich(rows);
  }

  async get(orgId: string, id: string): Promise<DecisionRow> {
    const { data, error } = await this.supabase.adminClient
      .from('ads_decisions')
      .select(DECISION_COLS)
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Decisão não encontrada.');
    const [enriched] = await this.enrich([data as unknown as DecisionRow]);
    return enriched as DecisionRow;
  }

  /** Aprova (registra intenção). Aplicação real = MVP-3. */
  async approve(orgId: string, id: string): Promise<DecisionRow> {
    await this.assertPending(orgId, id);
    return this.setStatus(orgId, id, 'approved');
  }

  async reject(orgId: string, id: string): Promise<DecisionRow> {
    await this.assertPending(orgId, id);
    return this.setStatus(orgId, id, 'rejected');
  }

  /** Edita o orçamento proposto antes de aprovar (drag na UI). */
  async editAfterBudget(
    orgId: string,
    id: string,
    afterBudgetBrl: number,
  ): Promise<DecisionRow> {
    const current = await this.assertPending(orgId, id);
    if (!Number.isFinite(afterBudgetBrl) || afterBudgetBrl <= 0) {
      throw new BadRequestException('after_budget_brl inválido.');
    }
    if (!('budget_cents' in current.after)) {
      throw new BadRequestException(
        'Esta decisão não é de orçamento — nada pra editar.',
      );
    }
    const after = { ...current.after, budget_cents: Math.round(afterBudgetBrl * 100) };
    const { data, error } = await this.supabase.adminClient
      .from('ads_decisions')
      .update({ after })
      .eq('org_id', orgId)
      .eq('id', id)
      .select(DECISION_COLS)
      .single();
    if (error || !data) throw new InternalServerErrorException(error?.message);
    const [enriched] = await this.enrich([data as unknown as DecisionRow]);
    return enriched as DecisionRow;
  }

  // ── internals ──────────────────────────────────────────────

  private async assertPending(orgId: string, id: string): Promise<DecisionRow> {
    const row = await this.get(orgId, id);
    if (row.status !== 'pending') {
      throw new BadRequestException(
        `Decisão com status "${row.status}" — só decisões pendentes podem ser alteradas.`,
      );
    }
    return row;
  }

  private async setStatus(
    orgId: string,
    id: string,
    status: DecisionStatus,
  ): Promise<DecisionRow> {
    const { data, error } = await this.supabase.adminClient
      .from('ads_decisions')
      .update({ status })
      .eq('org_id', orgId)
      .eq('id', id)
      .select(DECISION_COLS)
      .single();
    if (error || !data) throw new InternalServerErrorException(error?.message);
    const [enriched] = await this.enrich([data as unknown as DecisionRow]);
    return enriched as DecisionRow;
  }

  /** Anexa nome/external_id da entidade (1 query batch). */
  private async enrich(rows: DecisionRow[]): Promise<DecisionRow[]> {
    if (rows.length === 0) return rows;
    const ids = Array.from(new Set(rows.map((r) => r.entity_id)));
    const { data } = await this.supabase.adminClient
      .from('ads_entities')
      .select('id, name, external_id')
      .in('id', ids);
    const byId = new Map(
      ((data ?? []) as Array<{ id: string; name: string | null; external_id: string }>).map(
        (e) => [e.id, e],
      ),
    );
    return rows.map((r) => {
      const e = byId.get(r.entity_id);
      return { ...r, entity_name: e?.name ?? null, entity_external_id: e?.external_id ?? null };
    });
  }
}
