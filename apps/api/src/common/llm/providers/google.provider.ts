import { Logger } from '@nestjs/common';
import {
  LLM_CATALOG,
  LlmChatInput,
  LlmChatResult,
  LlmProvider,
  LlmProviderName,
} from '../llm-provider.interface';

/**
 * Stub do provider Google Gemini.
 *
 * Bloco A.1 entrega a infra; Gemini SDK (@google/generative-ai) entra
 * num bloco posterior junto com tradução de tools/multimodal. Por
 * enquanto, qualquer tentativa de selecionar provider 'google' em
 * /settings/llm é aceita (UI lista no dropdown), mas chamadas falham
 * com mensagem clara — fallback acontece no LlmService.
 */
export class GoogleProvider implements LlmProvider {
  readonly name: LlmProviderName = 'google';
  readonly supportedModels = LLM_CATALOG.google;
  private readonly logger = new Logger('GoogleProvider');

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_apiKey: string) {
    this.logger.warn('GoogleProvider em modo stub — chamadas vão falhar até implementar Gemini SDK');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async chat(_model: string, _input: LlmChatInput): Promise<LlmChatResult> {
    throw new Error(
      'Provider Google ainda não implementado. Selecione Anthropic ou OpenAI em /configuracoes > IA.',
    );
  }
}
