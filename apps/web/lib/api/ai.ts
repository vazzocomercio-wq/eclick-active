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
};
