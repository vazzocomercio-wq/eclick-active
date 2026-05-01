import type { UUID, ISODateString, ISODateOnly } from './common';

/** Decomposição do score (lead_scores.factors) */
export interface LeadScoreFactors {
  /** Score parcial (0–100) por dimensão — soma ponderada dá o score final */
  engagement?: number;
  recency?: number;
  fit?: number;
  intent?: number;
  /** Detalhes textuais explicando cada peso */
  details?: Array<{ factor: string; impact: number; reason: string }>;
}

/**
 * Score atual de cada contato. Recalculado periodicamente por job.
 * Tabela: active.lead_scores
 */
export interface LeadScore {
  id: UUID;
  org_id: UUID;
  contact_id: UUID;
  score: number;
  factors: LeadScoreFactors;
  previous_score: number | null;
  calculated_at: ISODateString;
}

/**
 * Snapshot diário de métricas do funil (uma linha por estágio por dia).
 * Tabela: active.funnel_analytics
 */
export interface FunnelAnalyticsSnapshot {
  id: UUID;
  org_id: UUID;
  pipeline_id: UUID;
  stage_id: UUID;
  snapshot_date: ISODateOnly;
  deals_count: number;
  total_value: number;
  /** Tempo médio (horas) que deals passaram nesse estágio antes de avançar */
  avg_time_in_stage_hours: number | null;
  /** Conversão (%) de deals que avançaram pra próxima etapa */
  conversion_rate: number | null;
  created_at: ISODateString;
}

/** Feedback qualitativo da IA sobre o desempenho do agente (agent_performance.ai_feedback) */
export interface AgentPerformanceAIFeedback {
  /** Pontos fortes identificados */
  strengths?: string[];
  /** Pontos a melhorar */
  improvements?: string[];
  /** Score geral 0–100 atribuído pela IA */
  score?: number;
  /** Insights específicos com exemplos */
  examples?: Array<{ type: 'good' | 'bad'; message_id?: UUID; observation: string }>;
}

/**
 * Métricas diárias de performance por agente.
 * Tabela: active.agent_performance
 */
export interface AgentPerformance {
  id: UUID;
  org_id: UUID;
  user_id: UUID;
  period_date: ISODateOnly;
  // Métricas de resposta (em milissegundos)
  avg_first_response_ms: number | null;
  avg_response_time_ms: number | null;
  // Volume
  conversations_handled: number;
  messages_sent: number;
  // Deals
  deals_created: number;
  deals_won: number;
  deals_lost: number;
  /** Receita total dos deals ganhos no período (BRL) */
  revenue: number;
  ai_feedback: AgentPerformanceAIFeedback;
  created_at: ISODateString;
}
