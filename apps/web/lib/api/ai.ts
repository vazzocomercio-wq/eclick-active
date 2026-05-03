import { api } from './client';

export interface DealScoreFactors {
  engagement: number;
  recency: number;
  fit: number;
  intent: number;
  details: string[];
}

export interface DealScoreResult {
  score: number;
  risk: 'low' | 'medium' | 'high' | 'critical';
  close_probability: number;
  next_action: string;
  factors: DealScoreFactors;
}

export interface FunnelAnalysisResult {
  total_pipeline_value: number;
  weighted_value: number;
  bottleneck_stage: string | null;
  bottleneck_reason: string | null;
  avg_cycle_days: number;
  conversion_rate: number;
  insights: string[];
  recommendations: string[];
}

export interface FunnelInsightsCache {
  pipeline_id: string;
  analysis: FunnelAnalysisResult | null;
  generated_at: string | null;
}

export interface SummarizeResult {
  summary: string;
  ai_interaction_id: string | null;
}

export interface SuggestionResult {
  suggestion: string;
  confidence: number;
  ai_interaction_id?: string | null;
}

export type AIFeedback = 'positive' | 'negative';

export interface UnansweredItem {
  message_id: string;
  created_at: string;
  text: string;
  is_question: boolean;
}

export interface GapsResult {
  unanswered_questions: Array<{ question: string; message_index: number }>;
  missing_profile_data: Array<{ field: string; reason: string }>;
  suggested_actions: string[];
}

export interface FeedbackStats {
  total_positive: number;
  total_negative: number;
  approval_rate: number;
  recent_negative_comments: Array<{ comment: string; at: string }>;
  weekly: Array<{
    week_start: string;
    positive: number;
    negative: number;
    approval_rate: number;
  }>;
}

export const aiApi = {
  scoreDeal(dealId: string) {
    return api.post<DealScoreResult>(`/ai/score-deal/${dealId}`);
  },
  analyzeFunnel(pipelineId: string) {
    return api.post<FunnelAnalysisResult>(`/ai/analyze-funnel/${pipelineId}`);
  },
  getFunnelInsights(pipelineId: string, signal?: AbortSignal) {
    return api.get<FunnelInsightsCache>(`/ai/funnel-insights/${pipelineId}`, { signal });
  },
  /** POST /ai/summarize/:conversationId — gera resumo e atualiza ai_summary */
  summarizeConversation(conversationId: string) {
    return api.post<SummarizeResult>(`/ai/summarize/${conversationId}`);
  },
  /** POST /ai/suggest/:conversationId — gera sugestão de resposta sob demanda */
  suggestResponse(conversationId: string) {
    return api.post<SuggestionResult>(`/ai/suggest/${conversationId}`);
  },
  /** PATCH /ai/interactions/:id/feedback — marca 👍/👎 da resposta */
  submitFeedback(
    interactionId: string,
    body: { feedback: AIFeedback; comment?: string },
  ) {
    return api.patch<void>(`/ai/interactions/${interactionId}/feedback`, body);
  },
  /** GET /ai/unanswered/:conversationId — perguntas inbound sem resposta */
  getUnansweredInConversation(conversationId: string, signal?: AbortSignal) {
    return api.get<UnansweredItem[]>(`/ai/unanswered/${conversationId}`, { signal });
  },
  /** GET /ai/gaps/:conversationId — análise IA de gaps (cache 5min) */
  getGaps(conversationId: string, signal?: AbortSignal) {
    return api.get<GapsResult>(`/ai/gaps/${conversationId}`, { signal });
  },
  /** GET /ai/feedback/stats — métricas de feedback pra Relatórios */
  getFeedbackStats(periodDays = 30, signal?: AbortSignal) {
    return api.get<FeedbackStats>('/ai/feedback/stats', {
      query: { period_days: periodDays },
      signal,
    });
  },
  /** POST /ai/fill-field — gera conteúdo pra um campo de texto */
  fillField(input: {
    entity_type: 'deal' | 'contact' | 'company' | 'task';
    entity_id: string;
    field_name: string;
    current_value?: string;
    hint?: string;
  }) {
    return api.post<{ value: string; ai_interaction_id: string | null }>(
      '/ai/fill-field',
      input,
    );
  },
};
