import type { LlmProviderName } from './llm-provider.interface';

/**
 * Preços por 1M tokens em USD. Fonte: docs oficiais (snapshot 2026-05-05).
 *
 * Atualizar quando provider mudar tabela. Modelos não listados → fallback
 * agressivo (input=10, output=30) pra não subestimar custo.
 */

export interface LlmPricing {
  input_per_mtok_usd: number;
  output_per_mtok_usd: number;
}

const FALLBACK_PRICING: LlmPricing = {
  input_per_mtok_usd: 10,
  output_per_mtok_usd: 30,
};

const PRICING: Record<LlmProviderName, Record<string, LlmPricing>> = {
  anthropic: {
    'claude-sonnet-4-6': { input_per_mtok_usd: 3.0, output_per_mtok_usd: 15.0 },
    'claude-opus-4': { input_per_mtok_usd: 15.0, output_per_mtok_usd: 75.0 },
    'claude-haiku-4-5-20251001': { input_per_mtok_usd: 1.0, output_per_mtok_usd: 5.0 },
    // Alias canônico (não-datado) — mesma tabela do snapshot datado. Mantém o
    // cálculo de custo correto quando o roteamento de tarefas baratas escolhe
    // o Haiku pelo id preferido HAIKU_MODEL_ID ('claude-haiku-4-5').
    'claude-haiku-4-5': { input_per_mtok_usd: 1.0, output_per_mtok_usd: 5.0 },
  },
  openai: {
    'gpt-5': { input_per_mtok_usd: 5.0, output_per_mtok_usd: 20.0 },
    'gpt-5-mini': { input_per_mtok_usd: 0.6, output_per_mtok_usd: 2.4 },
    'gpt-4.1': { input_per_mtok_usd: 3.0, output_per_mtok_usd: 12.0 },
  },
  google: {
    'gemini-2.5-pro': { input_per_mtok_usd: 1.25, output_per_mtok_usd: 5.0 },
    'gemini-2.5-flash': { input_per_mtok_usd: 0.15, output_per_mtok_usd: 0.6 },
  },
};

export function computeCost(
  provider: LlmProviderName,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = PRICING[provider]?.[model] ?? FALLBACK_PRICING;
  const cost =
    (inputTokens * pricing.input_per_mtok_usd +
      outputTokens * pricing.output_per_mtok_usd) /
    1_000_000;
  // Match numeric(10,6) do schema
  return Math.round(cost * 1_000_000) / 1_000_000;
}
