/**
 * e-Click Prospect — tipos compartilhados do módulo.
 *
 * Convenções:
 *  • cnpj/cpf armazenados SEM máscara (só dígitos).
 *  • phone em E.164 (+5511...).
 *  • email em lowercase.
 */

export type EntityType = 'pj' | 'pf';

export type EntityStatus =
  | 'novo'
  | 'enriquecido'
  | 'qualificado'
  | 'promovido'
  | 'descartado';

export type SourceLayer = 0 | 1 | 2;

export type ContactKind =
  | 'phone'
  | 'email'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'site'
  | 'linkedin'
  | 'whatsapp';

export type SubjectKind = 'pj' | 'pf_socio' | 'pf_lead';

export type LegalBasis =
  | 'legitimo_interesse'
  | 'consentimento'
  | 'contrato'
  | 'obrigacao_legal';

export type EnrichmentJobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped_gate';

export type MatchReviewStatus = 'pending' | 'merged' | 'rejected';

// ── Row shapes (alinhadas à migration 084) ────────────────────────────

export interface ProspectSourceRow {
  id: string;
  display_name: string;
  layer: SourceLayer;
  base_weight: number;
  is_pii_source: boolean;
  via_bridge: boolean;
  cost_cents_estimate: number;
  active: boolean;
  notes: string | null;
}

export interface ProspectEntityRow {
  id: string;
  org_id: string;
  entity_type: EntityType;
  cnpj: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  cpf: string | null;
  full_name: string | null;
  display_name: string | null;
  cnae: string | null;
  porte: string | null;
  natureza: string | null;
  situacao: string | null;
  address: Record<string, unknown> | null;
  geo: { x: number; y: number } | null;
  confidence_score: number;
  prospect_score: number;
  status: EntityStatus;
  promoted_at: string | null;
  promoted_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProspectSignalRow {
  id: string;
  entity_id: string;
  signal_type: string;
  value: Record<string, unknown> | null;
  weight: number;
  detected_at: string;
}

// ── DTOs (controllers) ────────────────────────────────────────────────

export interface CollectDto {
  entity_type: EntityType;
  /** PJ: CNPJ (com ou sem máscara) */
  cnpj?: string;
  /** PF: só se opt-in/inbound — coleta fria de PF é proibida por produto */
  cpf?: string;
  /** Fonte específica solicitada (default: detecta pelo input) */
  source_id?: string;
  /** Dados-semente (quando a fonte é descoberta externa como Places) */
  seed?: Record<string, unknown>;
}

export interface ListEntitiesQuery {
  status?: EntityStatus;
  min_score?: number;
  signal_type?: string;
  entity_type?: EntityType;
  limit?: number;
}

export interface EnrichDto {
  /** Camada-alvo. Respeita gate (Corte_1 ≥50, Corte_2 ≥70). */
  target_layer: SourceLayer;
  /** Força esta fonte específica (vs deixar routing decidir). */
  source_id?: string;
  /** Bypass do gate de score — use com cautela (default false). */
  bypass_gate?: boolean;
}

export interface PromoteDto {
  /** Pipeline de destino no Funil do Active. Default: configurado por org. */
  pipeline_id?: string;
  /** Razão da promoção — fica no card. */
  reason?: string;
}

export interface OptOutPublicDto {
  cnpj?: string;
  cpf?: string;
  /** E-mail do solicitante (rastreabilidade LGPD). */
  requester_email: string;
  reason?: string;
}

export interface ResolveMatchDto {
  decision: 'merge' | 'reject';
  notes?: string;
}

export interface DiscoverPlacesDto {
  /** Texto livre (ex.: "loja de cosméticos em Belo Horizonte MG"). */
  query: string;
  /** Filtro opcional (ex.: "Belo Horizonte MG"). */
  region?: string;
  /** Cap interno: 20 (limite do Places New por página). */
  max_results?: number;
}

// ── CAC report ────────────────────────────────────────────────────────

export interface CacReport {
  by_source: Array<{
    source_id: string;
    calls: number;
    cost_cents_total: number;
    promoted_count: number;
    cac_cents_per_promoted: number | null;
  }>;
  total_cost_cents: number;
  total_promoted: number;
}
