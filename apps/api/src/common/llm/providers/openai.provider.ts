import { Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import OpenAI from 'openai';
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
 * Implementação do contrato LlmProvider via openai SDK.
 *
 * Tradução de tipos:
 *   - LlmTool → tools[].function (OpenAI function calling)
 *   - LlmContentBlock image_base64 → content[{type: image_url, image_url: {url: data:base64}}]
 *   - json_mode → response_format: { type: 'json_object' }
 */
export class OpenAIProvider implements LlmProvider {
  readonly name: LlmProviderName = 'openai';
  readonly supportedModels = LLM_CATALOG.openai;
  private readonly logger = new Logger('OpenAIProvider');
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, maxRetries: 2 });
  }

  async chat(model: string, input: LlmChatInput): Promise<LlmChatResult> {
    const start = performance.now();

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: input.system },
      ...input.messages.map((m) => toOpenAIMessage(m)),
    ];

    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages,
      max_tokens: input.max_tokens ?? 1024,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.json_mode ? { response_format: { type: 'json_object' } } : {}),
      ...(input.tools && input.tools.length > 0
        ? {
            tools: input.tools.map((t) => ({
              type: 'function' as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.input_schema,
              },
            })),
          }
        : {}),
    };

    const response = await this.client.chat.completions.create(params);
    const latency_ms = Math.round(performance.now() - start);

    const choice = response.choices[0];
    const text = choice?.message?.content?.trim() ?? '';

    const tool_calls: LlmToolCall[] = (choice?.message?.tool_calls ?? [])
      .flatMap((tc) => {
        if (tc.type !== 'function') return [];
        const fn = (tc as { function: { name: string; arguments: string } }).function;
        return [
          {
            id: tc.id,
            name: fn.name,
            input: parseJsonSafe(fn.arguments),
          },
        ];
      });

    const stop_reason = mapFinishReason(choice?.finish_reason ?? null);

    const input_tokens = response.usage?.prompt_tokens ?? 0;
    const output_tokens = response.usage?.completion_tokens ?? 0;
    const cost_usd = computeCost('openai', model, input_tokens, output_tokens);

    return {
      text,
      tool_calls,
      stop_reason,
      input_tokens,
      output_tokens,
      latency_ms,
      cost_usd,
      provider: 'openai',
      model,
      raw: response,
    };
  }
}

function toOpenAIMessage(m: LlmMessage): OpenAI.Chat.ChatCompletionMessageParam {
  if (typeof m.content === 'string') {
    if (m.role === 'assistant') return { role: 'assistant', content: m.content };
    return { role: 'user', content: m.content };
  }
  const parts: OpenAI.Chat.ChatCompletionContentPart[] = m.content.map((b) =>
    toOpenAIPart(b),
  );
  // OpenAI assistant messages só aceitam content text simples; multimodal só
  // entra em user. Coerce assistant pra texto concatenado.
  if (m.role === 'assistant') {
    const text = m.content.filter((b) => b.type === 'text').map((b) => (b as Extract<LlmContentBlock, { type: 'text' }>).text).join('');
    return { role: 'assistant', content: text };
  }
  return { role: 'user', content: parts };
}

function toOpenAIPart(b: LlmContentBlock): OpenAI.Chat.ChatCompletionContentPart {
  if (b.type === 'text') return { type: 'text', text: b.text };
  return {
    type: 'image_url',
    image_url: { url: `data:${b.media_type};base64,${b.data}` },
  };
}

function mapFinishReason(
  reason: OpenAI.Chat.ChatCompletion.Choice['finish_reason'] | null,
): LlmChatResult['stop_reason'] {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'other';
    default:
      return 'other';
  }
}

function parseJsonSafe(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}
