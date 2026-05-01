/**
 * Tipos e schemas JSON do módulo de IA. Schemas são usados via
 * `output_config.format` (json_schema) pra forçar o modelo a retornar JSON
 * válido contra o shape esperado.
 *
 * Limitações do structured outputs do Claude:
 *  - `additionalProperties: false` é obrigatório em todo objeto
 *  - Não suporta minimum/maximum/minLength etc. — validação numérica fica
 *    no código (ex: confidence clamp 0..1).
 */

export type AIIntent =
  | 'budget'
  | 'question'
  | 'complaint'
  | 'negotiation'
  | 'support'
  | 'greeting'
  | 'farewell'
  | 'spam'
  | 'other';

export type AIUrgency = 'low' | 'medium' | 'high' | 'critical';

export interface ClassificationResult {
  intent: AIIntent;
  sentiment: 'very_positive' | 'positive' | 'neutral' | 'negative' | 'very_negative';
  temperature: 'cold' | 'warm' | 'hot' | 'very_hot';
  urgency: AIUrgency;
  /** Resumo em 1 frase do que o cliente quer */
  summary: string;
}

export interface SuggestionResult {
  suggested_response: string;
  /** 0..1 — clamp aplicado pós-parse (json_schema não suporta minimum/maximum) */
  confidence: number;
  reasoning: string;
}

// ──────────────────────────────────────────────────────────
// JSON Schemas (passados como `output_config.format.schema`)
// ──────────────────────────────────────────────────────────

export const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [
        'budget',
        'question',
        'complaint',
        'negotiation',
        'support',
        'greeting',
        'farewell',
        'spam',
        'other',
      ],
    },
    sentiment: {
      type: 'string',
      enum: ['very_positive', 'positive', 'neutral', 'negative', 'very_negative'],
    },
    temperature: {
      type: 'string',
      enum: ['cold', 'warm', 'hot', 'very_hot'],
    },
    urgency: {
      type: 'string',
      enum: ['low', 'medium', 'high', 'critical'],
    },
    summary: { type: 'string' },
  },
  required: ['intent', 'sentiment', 'temperature', 'urgency', 'summary'],
  additionalProperties: false,
} as const;

export const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    suggested_response: { type: 'string' },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
  },
  required: ['suggested_response', 'confidence', 'reasoning'],
  additionalProperties: false,
} as const;

// ──────────────────────────────────────────────────────────
// Constantes de modelo
// ──────────────────────────────────────────────────────────

/** Alias canônico (preferido sobre o ID datado claude-haiku-4-5-20251001). */
export const HAIKU_MODEL_ID = 'claude-haiku-4-5';

/**
 * Pricing 2026 (atualizou recentemente — antes era $0.80/$4.00).
 * Verificar periodicamente: https://platform.claude.com/docs/en/pricing
 */
export const HAIKU_PRICING = {
  input_per_mtok_usd: 1.0,
  output_per_mtok_usd: 5.0,
} as const;

// ──────────────────────────────────────────────────────────
// System prompts
// ──────────────────────────────────────────────────────────

export const CLASSIFY_SYSTEM_PROMPT =
  'Você é um classificador de mensagens comerciais brasileiras. Analise a mensagem do cliente e o contexto da conversa. Retorne APENAS JSON válido sem texto adicional, contendo: intent (intenção principal), sentiment (sentimento detectado), temperature (temperatura do lead), urgency (urgência) e summary (resumo em 1 frase do que o cliente quer).';

export const SUGGEST_SYSTEM_PROMPT =
  'Você é um assistente comercial brasileiro. Sugira uma resposta natural em português para o vendedor enviar ao cliente. Conduza a conversa em direção ao fechamento. Não invente informações sobre produtos, preços ou condições que não estejam explicitamente no contexto. A resposta deve ser concisa, educada e específica. Retorne JSON com: suggested_response (texto pronto pra enviar), confidence (0 a 1) e reasoning (justificativa curta da sua sugestão).';

export const SUMMARIZE_SYSTEM_PROMPT =
  'Você analisa conversas comerciais brasileiras e produz resumos curtos (2-3 frases) em português. Foque em: o que o cliente quer, em que estágio da negociação está, e qual a próxima ação esperada. Não invente fatos. Retorne apenas o resumo, sem prefixos como "Resumo:" ou aspas.';
