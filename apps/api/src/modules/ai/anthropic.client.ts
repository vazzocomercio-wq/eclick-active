import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import Anthropic from '@anthropic-ai/sdk';
import type { AIInteractionType } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { HAIKU_MODEL_ID, HAIKU_PRICING } from './ai.types';

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
 * Wrapper sobre @anthropic-ai/sdk com:
 *   - Inicialização lazy (não trava boot se ANTHROPIC_API_KEY ausente)
 *   - Cost tracking automático em active.ai_interactions
 *   - Parse de JSON quando `schema` é passado
 *   - Retry default (maxRetries: 2) — SDK já lida com 429/5xx
 */
@Injectable()
export class AnthropicClient implements OnModuleInit {
  private readonly logger = new Logger(AnthropicClient.name);
  private _client?: Anthropic;

  constructor(private readonly supabase: SupabaseService) {}

  onModuleInit(): void {
    if (!process.env.ANTHROPIC_API_KEY) {
      this.logger.warn(
        'ANTHROPIC_API_KEY ausente — chamadas de IA vão falhar até a env ser configurada.',
      );
    }
  }

  private getClient(): Anthropic {
    if (this._client) return this._client;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY não configurada');
    }
    this._client = new Anthropic({ apiKey, maxRetries: 2 });
    return this._client;
  }

  async complete<T>(input: CompleteInput): Promise<CompleteResult<T>> {
    const start = performance.now();

    // O SDK valida output_config quando passamos schema; sem schema, output é texto livre.
    const params: Record<string, unknown> = {
      model: HAIKU_MODEL_ID,
      max_tokens: input.max_tokens ?? 512,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
    };
    if (input.schema) {
      params.output_config = {
        format: { type: 'json_schema', schema: input.schema },
      };
    }

    let response: Anthropic.Message;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response = (await this.getClient().messages.create(params as any)) as Anthropic.Message;
    } catch (err) {
      const latency_ms = Math.round(performance.now() - start);
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Anthropic call failed: ${message}`);
      // Loga interação falhada com cost=0 pra ter visibilidade no painel
      await this.logInteraction({
        org_id: input.org_id,
        interaction_type: input.interaction_type,
        input_tokens: 0,
        output_tokens: 0,
        latency_ms,
        result_summary: `ERROR: ${message.slice(0, 180)}`,
        ...input.context,
        metadata: { error: message },
      }).catch(() => {});
      throw err;
    }

    const latency_ms = Math.round(performance.now() - start);
    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    if (!textBlock) {
      throw new Error('Resposta da Anthropic não contém bloco de texto');
    }

    let data: T;
    if (input.schema) {
      try {
        data = JSON.parse(textBlock.text) as T;
      } catch (err) {
        this.logger.error(
          `JSON inválido do modelo: ${textBlock.text.slice(0, 200)}`,
        );
        throw new Error(
          `Modelo retornou JSON inválido: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      data = textBlock.text as unknown as T;
    }

    const input_tokens = response.usage.input_tokens;
    const output_tokens = response.usage.output_tokens;
    const cost_usd = computeCost(input_tokens, output_tokens);

    // result_summary: snippet do output bruto pra debug no painel.
    // Pra JSON é o JSON cru truncado; pra texto livre é o texto.
    const result_summary = textBlock.text.slice(0, 200);

    const interaction_id = await this.logInteraction({
      org_id: input.org_id,
      interaction_type: input.interaction_type,
      input_tokens,
      output_tokens,
      latency_ms,
      result_summary,
      ...input.context,
      metadata: {},
    }).catch((err) => {
      this.logger.warn(
        `ai_interactions log failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    });

    return { data, cost_usd, input_tokens, output_tokens, latency_ms, interaction_id };
  }

  // ──────────────────────────────────────────────────────────
  // Cost / log helpers
  // ──────────────────────────────────────────────────────────

  private async logInteraction(input: {
    org_id: string;
    interaction_type: AIInteractionType;
    input_tokens: number;
    output_tokens: number;
    latency_ms: number;
    conversation_id?: string;
    contact_id?: string;
    deal_id?: string;
    user_id?: string;
    result_summary: string | null;
    metadata: Record<string, unknown>;
  }): Promise<string | null> {
    const cost_usd = computeCost(input.input_tokens, input.output_tokens);
    const { data, error } = await this.supabase.adminClient
      .from('ai_interactions')
      .insert({
        org_id: input.org_id,
        interaction_type: input.interaction_type,
        model: HAIKU_MODEL_ID,
        provider: 'anthropic',
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        cost_usd,
        latency_ms: input.latency_ms,
        conversation_id: input.conversation_id ?? null,
        contact_id: input.contact_id ?? null,
        deal_id: input.deal_id ?? null,
        user_id: input.user_id ?? null,
        result_summary: input.result_summary,
        metadata: input.metadata,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string } | null)?.id ?? null;
  }
}

/** Cost em USD com 6 casas (matcha numeric(10,6) do schema). */
function computeCost(input_tokens: number, output_tokens: number): number {
  const cost =
    (input_tokens * HAIKU_PRICING.input_per_mtok_usd +
      output_tokens * HAIKU_PRICING.output_per_mtok_usd) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
