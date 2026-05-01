import type { Plan, AIFeatureName, AIProvider } from '../enums';

/**
 * Limites por plano (espelha os defaults da migration `001_foundation_schema.sql`).
 * Use esses valores pra checagens client-side; o servidor usa o snapshot
 * em `active.organizations.max_*` (denormalizado pra evitar lookup).
 */
export const PLAN_LIMITS: Record<
  Plan,
  {
    max_users: number;
    max_channels: number;
    max_pipelines: number;
    max_automations: number;
    has_copilot: boolean;
    has_audit: boolean;
    has_erp_integration: boolean;
    /** Preço sugerido em BRL/mês (referencial — billing real fica em outra tabela) */
    monthly_price_brl: number;
  }
> = {
  starter: {
    max_users: 3,
    max_channels: 1,
    max_pipelines: 2,
    max_automations: 5,
    has_copilot: false,
    has_audit: false,
    has_erp_integration: false,
    monthly_price_brl: 199,
  },
  professional: {
    max_users: 10,
    max_channels: 5,
    max_pipelines: 5,
    max_automations: 30,
    has_copilot: true,
    has_audit: false,
    has_erp_integration: false,
    monthly_price_brl: 599,
  },
  enterprise: {
    max_users: 50,
    max_channels: 20,
    max_pipelines: 20,
    max_automations: 200,
    has_copilot: true,
    has_audit: true,
    has_erp_integration: true,
    monthly_price_brl: 1999,
  },
};

/**
 * Estágios padrão criados por `active.setup_new_organization()`.
 * Mantém sincronizado com a função SQL.
 */
export const DEFAULT_PIPELINE_STAGES: Array<{
  name: string;
  color: string;
  probability: number;
  is_won?: boolean;
  is_lost?: boolean;
}> = [
  { name: 'Novo Lead', color: '#00E5FF', probability: 10 },
  { name: 'Contato Realizado', color: '#0EA5E9', probability: 20 },
  { name: 'Qualificado', color: '#8B5CF6', probability: 40 },
  { name: 'Proposta Enviada', color: '#F59E0B', probability: 60 },
  { name: 'Negociação', color: '#EF4444', probability: 80 },
  { name: 'Fechamento', color: '#22C55E', probability: 95 },
  { name: 'Ganho', color: '#22C55E', probability: 100, is_won: true },
  { name: 'Perdido', color: '#6B7280', probability: 0, is_lost: true },
];

/**
 * Configuração default das features de IA (espelha `setup_new_organization()`).
 * Modelos podem ser sobrescritos por org via `ai_feature_settings`.
 */
export const DEFAULT_AI_FEATURE_SETTINGS: Array<{
  feature_name: AIFeatureName;
  provider: AIProvider;
  model: string;
  enabled: boolean;
}> = [
  { feature_name: 'auto_classify', provider: 'anthropic', model: 'claude-haiku-4-5-20251001', enabled: true },
  { feature_name: 'suggest_response', provider: 'anthropic', model: 'claude-haiku-4-5-20251001', enabled: true },
  { feature_name: 'summarize', provider: 'anthropic', model: 'claude-haiku-4-5-20251001', enabled: true },
  { feature_name: 'sentiment', provider: 'anthropic', model: 'claude-haiku-4-5-20251001', enabled: true },
  { feature_name: 'lead_scoring', provider: 'anthropic', model: 'claude-sonnet-4-6', enabled: true },
  { feature_name: 'copilot', provider: 'anthropic', model: 'claude-sonnet-4-6', enabled: false },
  { feature_name: 'auto_respond', provider: 'anthropic', model: 'claude-sonnet-4-6', enabled: false },
  { feature_name: 'follow_up_agent', provider: 'anthropic', model: 'claude-haiku-4-5-20251001', enabled: false },
];

/** Cores da brand (centralizadas pra reutilização em CSS-in-JS, charts, etc.) */
export const BRAND_COLORS = {
  cyan: '#00E5FF',
  green: '#4ADE50',
  bg_dark: '#09090B',
  surface: '#111115',
  border: '#2A2A2E',
} as const;
