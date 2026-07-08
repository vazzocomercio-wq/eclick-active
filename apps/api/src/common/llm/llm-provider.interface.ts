/**
 * Contrato unificado pra qualquer provider de LLM (Anthropic, OpenAI, Google).
 *
 * Princípio: o ConsumidorSomente conhece este arquivo. Switching de provider
 * acontece exclusivamente em LlmService.resolveProvider(orgId), sem mexer
 * em código de feature.
 *
 * Cobre no MVP:
 *   - chat() — text + tools (Anthropic & OpenAI implementam, Google stub)
 *   - chatVision() — multimodal (image_base64) [Bloco A.2 — attachments]
 *
 * Não cobre (intencional):
 *   - streaming — copilot é o único candidato; quando precisar, adicionar
 *     método chatStream().
 */

export type LlmProviderName = 'anthropic' | 'openai' | 'google';

export type LlmRole = 'user' | 'assistant';

/** Bloco de conteúdo dentro de uma message — text simples, imagem ou PDF inline. */
export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_base64'; media_type: string; data: string }
  /** PDF inline base64. Provider-specific: Anthropic suporta nativo;
   *  OpenAI/Google rejeitam (precisaria converter pra image antes). */
  | { type: 'pdf_base64'; data: string };

/** Message dentro do array messages do chat. */
export interface LlmMessage {
  role: LlmRole;
  /** String simples ou array de blocos (text+image). */
  content: string | LlmContentBlock[];
}

/** Tool definition (compatível com Anthropic.Tool — OpenAI traduz internamente). */
export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema do input. */
  input_schema: Record<string, unknown>;
}

/** Resultado de tool_use no output. */
export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Input pra chamada chat. */
export interface LlmChatInput {
  /** System prompt — estático. */
  system: string;
  /** Histórico/turno atual. Sempre termina com role=user. */
  messages: LlmMessage[];
  /** Default 1024. */
  max_tokens?: number;
  /**
   * Se true, força output JSON puro. Provider responsabilidade:
   * - Anthropic: reforço no system + parse seguro
   * - OpenAI: response_format = {type: json_object}
   * - Google: responseMimeType = application/json
   */
  json_mode?: boolean;
  /** Tools disponíveis (function calling). */
  tools?: LlmTool[];
  /** Temperatura 0-1. Default provider-specific. */
  temperature?: number;
}

/** Output unificado. */
export interface LlmChatResult {
  /** Texto extraído (string vazia se output foi só tool_use). */
  text: string;
  /** Tool calls solicitadas pelo modelo (vazio = nenhuma). */
  tool_calls: LlmToolCall[];
  /** Stop reason normalizado. */
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'other';
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  cost_usd: number;
  /** Provider/model usados (auditing). */
  provider: LlmProviderName;
  model: string;
  /** Resposta crua (debug, opcional). */
  raw?: unknown;
}

/**
 * Contrato implementado por cada provider concreto. LlmService chama isso
 * depois de resolver creds + escolher provider pra org.
 */
export interface LlmProvider {
  readonly name: LlmProviderName;

  /** Modelos suportados por este provider (catálogo). */
  readonly supportedModels: readonly string[];

  /** Chamada principal. Provider lida com SDK retries internamente. */
  chat(model: string, input: LlmChatInput): Promise<LlmChatResult>;
}

/**
 * Catálogo de modelos por provider. Read-only — UI lê pra montar dropdown.
 * Manter sincronizado com llm-pricing.ts.
 */
export const LLM_CATALOG: Record<LlmProviderName, readonly string[]> = {
  anthropic: [
    'claude-sonnet-4-6',
    'claude-opus-4',
    'claude-haiku-4-5',
    'claude-haiku-4-5-20251001',
  ],
  openai: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
} as const;

export const LLM_DEFAULT_MODEL: Record<LlmProviderName, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5-mini',
  google: 'gemini-2.5-flash',
};

/**
 * Tier de tarefa pro roteamento de modelo por custo.
 *   - 'smart': modelo de raciocínio (default seguro = comportamento atual,
 *      normalmente Sonnet / o model_default configurado pela org).
 *   - 'cheap': modelo barato/mecânico (Haiku no Anthropic, mini/flash nos
 *      outros) pra classificação, extração e parse — corta custo por mensagem.
 */
export type LlmTier = 'cheap' | 'smart';

/**
 * Modelo barato por provider, usado quando a feature é de tier 'cheap'.
 * É sempre um modelo do catálogo do próprio provider — assim trocar o
 * provider da org nunca escolhe um modelo inexistente. Anthropic usa o alias
 * não-datado 'claude-haiku-4-5' (tem pricing em llm-pricing.ts).
 */
export const LLM_CHEAP_MODEL: Record<LlmProviderName, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-5-mini',
  google: 'gemini-2.5-flash',
};
