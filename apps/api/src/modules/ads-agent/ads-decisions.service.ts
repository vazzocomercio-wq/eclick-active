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
  /** Nível anúncio (ML): nome da campanha-pai (resolvido de before.campaign_id). */
  campaign_name?: string | null;
  outcome_verdict?: string | null;
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

  /** Anexa nome/external_id da entidade + veredito do outcome (batch). */
  private async enrich(rows: DecisionRow[]): Promise<DecisionRow[]> {
    if (rows.length === 0) return rows;
    const entIds = Array.from(new Set(rows.map((r) => r.entity_id)));
    const decIds = rows.map((r) => r.id);
    // Nível anúncio (ML): a decisão guarda before.campaign_id (id da campanha-pai)
    // mas não o NOME — resolvemos aqui pra mostrar no card.
    const campaignExtIds = Array.from(
      new Set(
        rows
          .map((r) => (typeof r.before?.campaign_id === 'string' ? (r.before.campaign_id as string) : null))
          .filter((v): v is string => !!v),
      ),
    );
    const [entRes, outRes, campRes] = await Promise.all([
      this.supabase.adminClient.from('ads_entities').select('id, name, external_id').in('id', entIds),
      this.supabase.adminClient.from('ads_outcomes').select('decision_id, verdict').in('decision_id', decIds),
      campaignExtIds.length > 0
        ? this.supabase.adminClient
            .from('ads_entities')
            .select('external_id, name')
            .eq('level', 'campaign')
            .in('external_id', campaignExtIds)
        : Promise.resolve({ data: [] as Array<{ external_id: string; name: string | null }> }),
    ]);
    const byId = new Map(
      ((entRes.data ?? []) as Array<{ id: string; name: string | null; external_id: string }>).map(
        (e) => [e.id, e],
      ),
    );
    const campNameByExt = new Map(
      ((campRes.data ?? []) as Array<{ external_id: string; name: string | null }>).map(
        (c) => [c.external_id, c.name],
      ),
    );
    const verdictByDec = new Map(
      ((outRes.data ?? []) as Array<{ decision_id: string; verdict: string }>).map(
        (o) => [o.decision_id, o.verdict],
      ),
    );
    return rows.map((r) => {
      const e = byId.get(r.entity_id);
      const campExt = typeof r.before?.campaign_id === 'string' ? (r.before.campaign_id as string) : null;
      return {
        ...r,
        entity_name: e?.name ?? null,
        entity_external_id: e?.external_id ?? null,
        campaign_name: campExt ? campNameByExt.get(campExt) ?? null : null,
        outcome_verdict: verdictByDec.get(r.id) ?? null,
      };
    });
  }
}
