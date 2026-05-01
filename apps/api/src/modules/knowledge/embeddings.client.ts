import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import OpenAI from 'openai';

/**
 * Wrapper sobre o SDK da OpenAI para gerar embeddings via
 * text-embedding-3-small (1536 dims). Mesmo formato do schema:
 * `vector(1536)` em active.knowledge_documents.
 *
 * Custo: ~$0.02 / 1M tokens. Falha graciosamente se OPENAI_API_KEY ausente
 * — `embed()` retorna `null` e o caller decide se persiste sem embedding
 * (documento vai existir mas não vai aparecer na busca semântica).
 */
@Injectable()
export class EmbeddingsClient implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingsClient.name);
  private _client?: OpenAI;
  /** Modelo padrão. Mudar requer reindex (1536 dims é fixo no schema). */
  private readonly model = 'text-embedding-3-small';

  onModuleInit(): void {
    if (!process.env.OPENAI_API_KEY) {
      this.logger.warn(
        'OPENAI_API_KEY ausente — embeddings vão retornar null (documentos serão criados sem busca semântica até a env ser configurada).',
      );
    }
  }

  private getClient(): OpenAI | null {
    if (this._client) return this._client;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    this._client = new OpenAI({ apiKey, maxRetries: 2 });
    return this._client;
  }

  /**
   * Gera embedding pra um texto. Retorna null se o SDK não está configurado
   * ou se a chamada falhar — o caller registra o documento sem embedding.
   */
  async embed(text: string): Promise<number[] | null> {
    const client = this.getClient();
    if (!client) return null;

    const trimmed = text.trim();
    if (!trimmed) return null;

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
      this.logger.error(`embed failed: ${msg}`);
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
