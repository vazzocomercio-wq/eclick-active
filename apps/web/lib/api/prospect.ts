import { api } from './client';

/**
 * Cliente do módulo e-Click Prospect.
 * Backend: apps/api/src/modules/prospect/.
 */

export type EntityType = 'pj' | 'pf';
export type EntityStatus = 'novo' | 'enriquecido' | 'qualificado' | 'promovido' | 'descartado';

export interface ProspectEntity {
  id: string;
  org_id: string;
  entity_type: EntityType;
  cnpj: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  display_name: string | null;
  cnae: string | null;
  porte: string | null;
  situacao: string | null;
  address: Record<string, unknown> | null;
  confidence_score: number;
  prospect_score: number;
  status: EntityStatus;
  promoted_at: string | null;
  promoted_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProspectContact {
  id: string;
  kind: string;
  value: string;
  confidence: number;
  validated_in: number;
  is_pii: boolean;
}

export interface ProspectSignal {
  id: string;
  signal_type: string;
  value: Record<string, unknown> | null;
  weight: number;
  detected_at: string;
}

export interface ConsentLedgerRow {
  id: string;
  subject_kind: string;
  legal_basis: string;
  origin: string;
  consent_at: string | null;
  opt_out_at: string | null;
  retention_until: string | null;
}

export interface ProspectProfile {
  entity: ProspectEntity;
  contacts: ProspectContact[];
  signals: ProspectSignal[];
  consent_ledger: ConsentLedgerRow[];
  provenance: Array<{
    id: string;
    match_method: string;
    match_confidence: number;
    raw_record: { source_id: string; collected_at: string } | null;
  }>;
}

export interface MatchReviewItem {
  id: string;
  similarity: number;
  match_method: string;
  status: 'pending' | 'merged' | 'rejected';
  created_at: string;
  context: Record<string, unknown> | null;
  a: { id: string; display_name: string | null; cnpj: string | null; prospect_score: number } | null;
  b: { id: string; display_name: string | null; cnpj: string | null; prospect_score: number } | null;
}

export interface ScoreBreakdown {
  entity_id: string;
  score_before: number;
  score_after: number;
  status_changed_to: string | null;
  breakdown: Array<{ signal: string; weight: number; reason: string }>;
}

export interface PromoteResult {
  contact_id: string;
  deal_id: string;
  pipeline_id: string;
  stage_id: string;
  promoted_at: string;
  ai_pitch: string;
}

export interface DiscoverPlacesResult {
  discovered: number;
  created: number;
  updated: number;
  skipped_closed: number;
  entities: Array<{ id: string; display_name: string; place_id: string }>;
}

export const prospectApi = {
  collect: (input: { entity_type: EntityType; cnpj?: string; source_id?: string }) =>
    api.post<{ entity_id: string; status: string; source_used: string }>('/prospect/collect', input),

  discoverPlaces: (input: { query: string; region?: string; max_results?: number }) =>
    api.post<DiscoverPlacesResult>('/prospect/discover/places', input),

  list: (filters?: {
    status?: EntityStatus;
    min_score?: number;
    signal_type?: string;
    entity_type?: EntityType;
    limit?: number;
  }) =>
    api.get<ProspectEntity[]>('/prospect/entities', {
      query: filters as Record<string, string | number | undefined> | undefined,
    }),

  get: (id: string) => api.get<ProspectProfile>(`/prospect/entities/${id}`),

  enrich: (id: string, input: { target_layer: 0 | 1 | 2; source_id?: string; bypass_gate?: boolean }) =>
    api.post<{ job_id: string; status: string; gate_reason: string | null }>(
      `/prospect/entities/${id}/enrich`,
      input,
    ),

  promote: (id: string, input?: { pipeline_id?: string; reason?: string }) =>
    api.post<PromoteResult>(`/prospect/entities/${id}/promote`, input ?? {}),

  optOut: (id: string, reason?: string) =>
    api.post<{ ok: true }>(`/prospect/entities/${id}/opt-out`, { reason }),

  resolve: (id: string) =>
    api.post<{ embedding_generated: boolean; auto_merged_with: string | null }>(
      `/prospect/entities/${id}/resolve`,
      {},
    ),

  score: (id: string) => api.post<ScoreBreakdown>(`/prospect/entities/${id}/score`, {}),

  matchReview: () => api.get<MatchReviewItem[]>('/prospect/match-review'),

  resolveMatch: (id: string, input: { decision: 'merge' | 'reject'; notes?: string }) =>
    api.post(`/prospect/match-review/${id}/resolve`, input),

  cacReport: () =>
    api.get<{
      by_source: Array<{
        source_id: string;
        calls: number;
        cost_cents_total: number;
        promoted_count: number;
        cac_cents_per_promoted: number | null;
      }>;
      total_cost_cents: number;
      total_promoted: number;
    }>('/prospect/reports/cac'),
};
