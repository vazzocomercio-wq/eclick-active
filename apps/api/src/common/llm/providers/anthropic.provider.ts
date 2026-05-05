import { Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import Anthropic from '@anthropic-ai/sdk';
import {
  LLM_CATALOG,
  LlmChatInput,
  LlmChatResult,
  LlmContentBlock,
  LlmMessage,
  LlmProvider,
  LlmProviderName,
  LlmToolCall,
} from '../llm-provider.interface';
import { computeCost } from '../llm-pricing';

/**
 * Implementação do contrato LlmProvider via @anthropic-ai/sdk.
 *
 * Construído com api_key específica (uma instância por org). Cache do
 * client é responsabilidade do LlmService.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name: LlmProviderName = 'anthropic';
  readonly supportedModels = LLM_CATALOG.anthropic;
  private readonly logger = new Logger('AnthropicProvider');
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  async chat(model: string, input: LlmChatInput): Promise<LlmChatResult> {
    const start = performance.now();

    // JSON mode: reforça no system + parser fica com o consumer (json_mode true
    // só promete que o modelo TENTA retornar JSON puro). Anthropic não tem
    // response_format nativo equivalente.
    const systemFinal = input.json_mode
      ? `${input.system}\n\nIMPORTANTE: Sua resposta deve ser EXCLUSIVAMENTE um objeto JSON válido, sem markdown, sem \`\`\`json, sem texto explicativo. Apenas o JSON puro começando com { e terminando com }.`
      : input.system;

    const messages: Anthropic.MessageParam[] = input.messages.map((m) =>
      toAnthropicMessage(m),
    );

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: input.max_tokens ?? 1024,
      system: systemFinal,
      messages,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.tools && input.tools.length > 0
        ? {
            tools: input.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema:
                t.input_schema as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
    };

    const response = await this.client.messages.create(params);
    const latency_ms = Math.round(performance.now() - start);

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    const text = textBlocks.map((b) => b.text).join('').trim();

    const tool_calls: LlmToolCall[] = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({
        id: b.id,
        name: b.name,
        input: (b.input as Record<string, unknown>) ?? {},
      }));

    const stop_reason = mapStopReason(response.stop_reason);

    const input_tokens = response.usage.input_tokens;
    const output_tokens = response.usage.output_tokens;
    const cost_usd = computeCost('anthropic', model, input_tokens, output_tokens);

    return {
      text,
      tool_calls,
      stop_reason,
      input_tokens,
      output_tokens,
      latency_ms,
      cost_usd,
      provider: 'anthropic',
      model,
      raw: response,
    };
  }
}

function toAnthropicMessage(m: LlmMessage): Anthropic.MessageParam {
  if (typeof m.content === 'string') {
    return { role: m.role, content: m.content };
  }
  const blocks: Anthropic.ContentBlockParam[] = m.content.map((b) =>
    toAnthropicBlock(b),
  );
  return { role: m.role, content: blocks };
}

function toAnthropicBlock(b: LlmContentBlock): Anthropic.ContentBlockParam {
  if (b.type === 'text') return { type: 'text', text: b.text };
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: b.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
      data: b.data,
    },
  };
}

function mapStopReason(
  reason: Anthropic.Message['stop_reason'],
): LlmChatResult['stop_reason'] {
  switch (reason) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    default:
      return 'other';
  }
}
