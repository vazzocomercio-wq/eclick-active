import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { LlmService } from '../../common/llm/llm.service';

/**
 * Wrapper sobre o SDK da OpenAI para gerar embeddings via
 * text-embedding-3-small (1536 dims). Mesmo formato do schema:
 * `vector(1536)` em active.knowledge_documents.
 *
 * BYOK: a chave OpenAI é resolvida POR ORG via `LlmService.resolveOpenAiKey`
 * (chave de chat openai → slot dedicado → env OPENAI_API_KEY no modo platform).
 * Org em modo 'own' sem chave → `embed()` retorna `null` (degrada gracioso:
 * documento é criado sem embedding, não aparece na busca semântica até a org
 * conectar a chave). Custo: ~$0.02 / 1M tokens.
 */
@Injectable()
export class EmbeddingsClient {
  private readonly logger = new Logger(EmbeddingsClient.name);
  /** Cache de clients OpenAI por chave (evita recriar SDK a cada call). */
  private readonly clients = new Map<string, OpenAI>();
  /** Modelo padrão. Mudar requer reindex (1536 dims é fixo no schema). */
  private readonly model = 'text-embedding-3-small';

  constructor(private readonly llm: LlmService) {}

  private async getClient(orgId: string): Promise<OpenAI | null> {
    let apiKey: string | null;
    try {
      apiKey = await this.llm.resolveOpenAiKey(orgId, { allowNull: true });
    } catch {
      // resolveOpenAiKey só lança quando allowNull=false; aqui é defensivo.
      apiKey = null;
    }
    if (!apiKey) return null;
    const cached = this.clients.get(apiKey);
    if (cached) return cached;
    const client = new OpenAI({ apiKey, maxRetries: 2 });
    this.clients.set(apiKey, client);
    return client;
  }

  /**
   * Gera embedding pra um texto, usando a chave OpenAI da org. Retorna null
   * se a org não tem chave disponível (modo own sem chave, ou platform sem
   * OPENAI_API_KEY) ou se a chamada falhar — o caller registra o documento
   * sem embedding.
   */
  async embed(text: string, orgId: string): Promise<number[] | null> {
    const trimmed = text.trim();
    if (!trimmed) return null;

    const client = await this.getClient(orgId);
    if (!client) return null;

    try {
      const response = await client.embeddings.create({
        model: this.model,
        input: trimmed,
      });
      const vector = response.data[0]?.embedding;
      if (!vector || vector.length !== 1536) {
        this.logger.error(
          `embedding inesperado: length=${vector?.length}, expected 1536`,
        );
        return null;
      }
      return vector;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`embed failed (org=${orgId}): ${msg}`);
      return null;
    }
  }

  /**
   * Estimativa rápida de tokens (chars / 4). Não é exata mas evita uma
   * roundtrip pra tiktoken. Usada apenas pra preencher `tokens` no doc.
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
