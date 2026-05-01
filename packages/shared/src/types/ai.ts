import type { UUID, ISODateString } from './common';
import type { AIInteractionType, AIProvider, AIFeatureName } from '../enums';

/**
 * Log de cada chamada de IA — usado pra cost tracking, audit e billing.
 * Tabela: active.ai_interactions (particionada por mês)
 */
export interface AIInteraction {
  id: UUID;
  org_id: UUID;
  interaction_type: AIInteractionType;
  /** Modelo usado (ex: 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6') */
  model: string;
  provider: AIProvider;
  input_tokens: number;
  output_tokens: number;
  /** Custo em USD com 6 casas decimais */
  cost_usd: number;
  latency_ms: number | null;
  // Contexto
  conversation_id: UUID | null;
  contact_id: UUID | null;
  deal_id: UUID | null;
  /** Quem disparou a chamada — null = sistema/automation */
  user_id: UUID | null;
  // Resultado
  result_summary: string | null;
  metadata: Record<string, unknown>;
  created_at: ISODateString;
}

/** Configuração específica por feature (ai_feature_settings.config) */
export interface AIFeatureConfig {
  /** Para auto_respond — quais canais participam */
  auto_respond_channels?: string[];
  /** Threshold de confiança pra acionar a feature (0–1) */
  confidence_threshold?: number;
  /** Janela de tempo para respostas automáticas (em segundos) */
  auto_respond_delay_seconds?: number;
  /** Personalidades / system prompts customizados */
  system_prompt?: string;
  /** Outros campos livres */
  [key: string]: unknown;
}

/**
 * Configuração de cada feature de IA por organização.
 * Tabela: active.ai_feature_settings
 */
export interface AIFeatureSetting {
  id: UUID;
  org_id: UUID;
  feature_name: AIFeatureName;
  provider: AIProvider;
  /** Modelo selecionado pela org pra essa feature */
  model: string;
  enabled: boolean;
  config: AIFeatureConfig;
  created_at: ISODateString;
  updated_at: ISODateString;
}
