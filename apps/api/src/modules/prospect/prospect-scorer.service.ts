import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';

/**
 * Prospect Score — ICP-first (decisão Vazzo 2026-05-28).
 *
 * O melhor lead da e-Click é o seller de marketplace com VOLUME mas
 * operação imatura (não tem e-commerce próprio, tem reclamações, posta
 * de forma amadora). Por isso o score privilegia sinais de operação ML/
 * Shopee/Amazon, não LinkedIn/eventos.
 *
 * Pesos (somam até 100):
 *   +30  marketplace_seller com volume
 *   +20  reputation_with_gaps (boa nota mas mediações/atraso)
 *   +15  no_own_ecommerce (só marketplace, sem site próprio)
 *   +10  posting_active (Instagram/Places com posts recentes)
 *   +10  high_reviews (rating ≥4.5 + count ≥30 via places_reviews)
 *   +10  cnae_retail (CNAE de varejo — começa com 47)
 *    +5  situacao_ativa (Receita: Ativa)
 *
 * Cortes:
 *   ≥50  Corte_1 — libera enriquecimento pago (camada 1).
 *   ≥70  Corte_2 — vira oportunidade, status='qualificado'.
 *
 * Score 0 = entity sem nenhum sinal. NÃO descarta — só fica como 'novo'.
 */

/** Sinais que somam pro score, na ordem de avaliação. */
const SIGNAL_WEIGHTS: Record<string, number> = {
  marketplace_seller: 30,
  reputation_with_gaps: 20,
  no_own_ecommerce: 15,
  posting_active: 10,
  places_reviews: 10,             // ganha o peso se o sinal tem `value.rating >= 4.5 && count >= 30`
  cnae_retail: 10,                // derivado da própria entity.cnae
  situacao_ativa: 5,              // derivado de entity.situacao
};

const CORTE_1 = 50;
const CORTE_2 = 70;

@Injectable()
export class ProspectScorerService {
  private readonly log = new Logger(ProspectScorerService.name);

  constructor(private readonly supabase: SupabaseService) {}

  private get db() {
    return this.supabase.adminClient.schema('prospect' as 'public');
  }

  /**
   * Recalcula prospect_score e atualiza status se cruzou corte.
   * Retorna o detalhamento da pontuação (auditável na UI).
   */
  async scoreEntity(orgId: string, entityId: string): Promise<{
    entity_id: string;
    score_before: number;
    score_after: number;
    status_changed_to: string | null;
    breakdown: Array<{ signal: string; weight: number; reason: string }>;
  }> {
    const { data: entity } = await this.db
      .from('entities')
      .select('id, prospect_score, status, cnae, situacao')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .maybeSingle();
    if (!entity) {
      this.log.warn(`[scorer] entity ${entityId} não encontrada`);
      return {
        entity_id: entityId,
        score_before: 0,
        score_after: 0,
        status_changed_to: null,
        breakdown: [],
      };
    }
    const e = entity as {
      id: string;
      prospect_score: number;
      status: string;
      cnae: string | null;
      situacao: string | null;
    };

    const breakdown: Array<{ signal: string; weight: number; reason: string }> = [];

    // 1) Sinais (signals table)
    const { data: signals } = await this.db
      .from('signals')
      .select('signal_type, value')
      .eq('entity_id', entityId);

    const sigList = (signals ?? []) as Array<{ signal_type: string; value: Record<string, unknown> | null }>;
    const seenSignals = new Set<string>();
    for (const s of sigList) {
      const baseWeight = SIGNAL_WEIGHTS[s.signal_type];
      if (baseWeight == null) continue;
      if (seenSignals.has(s.signal_type)) continue;     // não soma 2x o mesmo tipo
      // places_reviews é condicional ao rating/count
      if (s.signal_type === 'places_reviews') {
        const rating = Number((s.value as Record<string, unknown>)?.['rating'] ?? 0);
        const count = Number((s.value as Record<string, unknown>)?.['count'] ?? 0);
        if (rating >= 4.5 && count >= 30) {
          breakdown.push({
            signal: 'high_reviews',
            weight: baseWeight,
            reason: `rating ${rating} × ${count} avaliações`,
          });
          seenSignals.add(s.signal_type);
        }
        continue;
      }
      breakdown.push({
        signal: s.signal_type,
        weight: baseWeight,
        reason: 'sinal detectado',
      });
      seenSignals.add(s.signal_type);
    }

    // 2) Derivados de entity (CNAE, situação)
    if (e.cnae && e.cnae.startsWith('47')) {
      breakdown.push({
        signal: 'cnae_retail',
        weight: SIGNAL_WEIGHTS.cnae_retail!,
        reason: `CNAE ${e.cnae} (varejo)`,
      });
    }
    if (e.situacao && /ativ/i.test(e.situacao)) {
      breakdown.push({
        signal: 'situacao_ativa',
        weight: SIGNAL_WEIGHTS.situacao_ativa!,
        reason: `situacao=${e.situacao}`,
      });
    }

    const scoreAfter = Math.min(100, breakdown.reduce((sum, b) => sum + b.weight, 0));
    const scoreBefore = e.prospect_score ?? 0;

    // 3) Decide status novo
    let newStatus: string | null = null;
    if (scoreAfter >= CORTE_2 && e.status === 'novo') newStatus = 'qualificado';
    else if (scoreAfter >= CORTE_2 && e.status === 'enriquecido') newStatus = 'qualificado';

    const updates: Record<string, unknown> = { prospect_score: scoreAfter };
    if (newStatus) updates.status = newStatus;

    if (scoreAfter !== scoreBefore || newStatus) {
      const { error } = await this.db
        .from('entities')
        .update(updates)
        .eq('id', entityId);
      if (error) {
        this.log.error(`[scorer] update fail entity=${entityId}: ${error.message}`);
      }
    }

    this.log.log(
      `[scorer] entity=${entityId} score ${scoreBefore}→${scoreAfter}` +
      (newStatus ? ` status→${newStatus}` : ''),
    );

    return {
      entity_id: entityId,
      score_before: scoreBefore,
      score_after: scoreAfter,
      status_changed_to: newStatus,
      breakdown,
    };
  }

  /** Recalcula score de TODAS as entities de uma org (use com cautela). */
  async rescoreOrg(orgId: string, opts?: { onlyStatus?: string[] }): Promise<{ updated: number; }> {
    let q = this.db.from('entities').select('id').eq('org_id', orgId);
    if (opts?.onlyStatus?.length) q = q.in('status', opts.onlyStatus);
    const { data } = await q;
    const rows = (data ?? []) as Array<{ id: string }>;
    let updated = 0;
    for (const r of rows) {
      const result = await this.scoreEntity(orgId, r.id);
      if (result.score_after !== result.score_before) updated += 1;
    }
    return { updated };
  }
}
