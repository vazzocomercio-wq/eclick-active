import { Injectable, Logger } from '@nestjs/common';
import type { AIInteractionType } from '@eclick-active/shared';
import { LlmService } from '../../common/llm/llm.service';

interface CompleteInput {
  /** Tipo da interação — vai pro `ai_interactions.interaction_type` */
  interaction_type: AIInteractionType;
  org_id: string;
  /** System prompt — estático, candidato a prompt caching futuro */
  system: string;
  /** User content da chamada */
  user: string;
  /** Se passado, força output JSON validado server-side via output_config.format */
  schema?: object;
  /** Default 512 — JSON pequeno cabe folgado */
  max_tokens?: number;
  /** Vínculos pra audit no ai_interactions */
  context?: {
    conversation_id?: string;
    contact_id?: string;
    deal_id?: string;
    user_id?: string;
  };
}

interface CompleteResult<T> {
  data: T;
  /** Custo USD desse call (já calculado pelo wrapper) */
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  /** ID da row inserida em ai_interactions — null se a inserção falhou. */
  interaction_id: string | null;
}

/**
 * Adapter de retrocompatibilidade sobre LlmService.
 *
 * Mantém a interface `complete<T>()` que ai.service, data-collection.service
 * e transfer.service já consomem. Internamente delega pro LlmService — assim
 * essas features ganham automaticamente: cred per org, multi-provider,
 * tracking unificado.
 *
 * Quando todos os consumers migrarem direto pro LlmService, este wrapper pode
 * ser removido.
 */
@Injectable()
export class AnthropicClient {
  private readonly logger = new Logger(AnthropicClient.name);

  constructor(private readonly llm: LlmService) {}

  async complete<T>(input: CompleteInput): Promise<CompleteResult<T>> {
    const res = await this.llm.chat({
      orgId: input.org_id,
      feature: input.interaction_type,
      system: input.system,
      user: input.user,
      max_tokens: input.max_tokens ?? 512,
      json_mode: !!input.schema,
      context: input.context,
    });

    let data: T;
    if (input.schema) {
      data = parseJsonSafe<T>(res.text);
    } else {
      data = res.text as unknown as T;
    }

    return {
      data,
      cost_usd: res.cost_usd,
      input_tokens: res.input_tokens,
      output_tokens: res.output_tokens,
      latency_ms: res.latency_ms,
      interaction_id: res.interaction_id,
    };
  }
}

/**
 * Parser tolerante: tenta direto, depois strip de markdown fences, depois
 * regex pra achar primeiro {...}. Lança erro descritivo se nada bate.
 */
function parseJsonSafe<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch (err) {
        throw new Error(
          `Modelo retornou JSON inválido: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    throw new Error('Modelo retornou JSON inválido');
  }
}
