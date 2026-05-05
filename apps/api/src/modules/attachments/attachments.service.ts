import { Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import Anthropic from '@anthropic-ai/sdk';
import { SupabaseService } from '../../common/supabase/supabase.service';

const VISION_MODEL = 'claude-sonnet-4-6';
const SIGNED_URL_TTL_SECONDS = 60 * 30; // 30min — UI usa pra exibir mídia

/** Pricing Sonnet 4.6 (USD por milhão de tokens). */
const SONNET_INPUT_PER_MTOK = 3.0;
const SONNET_OUTPUT_PER_MTOK = 15.0;

interface AttachmentRow {
  id: string;
  org_id: string;
  message_id: string;
  conversation_id: string;
  contact_id: string | null;
  media_type: 'image' | 'audio' | 'video' | 'document';
  mime_type: string | null;
  file_name: string | null;
  storage_path: string;
  metadata: Record<string, unknown>;
}

/**
 * AttachmentsService — gerencia mídia inbound salva em
 * `active.attachments` + bucket Supabase Storage `message-media`.
 *
 * Responsabilidades:
 *   1. Processar attachments pendentes (ai_processed_at IS NULL) com
 *      Anthropic Vision pra gerar resumo + extração estruturada.
 *   2. Gerar signed URLs pra UI exibir a mídia.
 *
 * Worker de processamento corre em ciclo (AttachmentsWorker), best-effort.
 */
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);
  private _client?: Anthropic;

  constructor(private readonly supabase: SupabaseService) {}

  private getClient(): Anthropic {
    if (this._client) return this._client;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente');
    this._client = new Anthropic({ apiKey, maxRetries: 2 });
    return this._client;
  }

  /**
   * Lista attachments pendentes de processamento de IA. Ordena por
   * created_at pra processar a fila em ordem chronológica. `limit` evita
   * sobrecarregar uma única chamada.
   */
  async listPending(limit = 5): Promise<AttachmentRow[]> {
    const { data } = await this.supabase.adminClient
      .from('attachments')
      .select(
        'id, org_id, message_id, conversation_id, contact_id, media_type, mime_type, file_name, storage_path, metadata',
      )
      .is('ai_processed_at', null)
      .order('created_at', { ascending: true })
      .limit(limit);
    return (data ?? []) as AttachmentRow[];
  }

  /**
   * Processa um attachment: faz download do Storage, chama Anthropic
   * Vision (só pra imagens MVP), salva ai_summary + ai_extracted.
   *
   * Comporta-se como idempotente — reprocessar é safe (sobrescreve).
   * Se falhar, marca ai_processed_at de qualquer forma com erro em
   * ai_extracted pra evitar reprocessar infinitamente em loop.
   */
  async processAttachment(att: AttachmentRow): Promise<void> {
    const start = performance.now();

    // Audio/video MVP: skipa por enquanto (pediria Whisper/transcript).
    if (att.media_type !== 'image' && att.media_type !== 'document') {
      await this.markProcessed(att.id, {
        ai_summary: null,
        ai_extracted: { skipped: true, reason: `media_type=${att.media_type} not supported yet` },
      });
      return;
    }

    // Document: por enquanto só PDF. Outros tipos vão registrar skip.
    if (att.media_type === 'document') {
      const isPdf = (att.mime_type ?? '').includes('pdf');
      if (!isPdf) {
        await this.markProcessed(att.id, {
          ai_summary: null,
          ai_extracted: { skipped: true, reason: `document mime=${att.mime_type} not supported yet` },
        });
        return;
      }
    }

    let buffer: Buffer;
    try {
      const { data, error } = await this.supabase.adminClient.storage
        .from('message-media')
        .download(att.storage_path);
      if (error || !data) {
        throw new Error(error?.message ?? 'download retornou vazio');
      }
      const arrayBuffer = await data.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (err) {
      this.logger.warn(
        `att ${att.id} download falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.markProcessed(att.id, {
        ai_summary: null,
        ai_extracted: {
          error: err instanceof Error ? err.message : String(err),
          stage: 'download',
        },
      });
      return;
    }

    const base64 = buffer.toString('base64');
    const mediaType = att.mime_type ?? (att.media_type === 'image' ? 'image/jpeg' : 'application/pdf');

    const captionFromMeta =
      typeof att.metadata.caption === 'string' ? att.metadata.caption : '';
    const userPrompt = [
      'Você está analisando uma mídia que um cliente enviou via WhatsApp pra uma empresa.',
      'Tarefa:',
      '1. Resuma o conteúdo em 1-2 frases pt-BR (ai_summary).',
      '2. Extraia dados estruturados úteis pra o CRM (ai_extracted) no shape:',
      '   { type: "image"|"document", contains_text: bool, ocr_text?: string,',
      '     entities?: { person?: string[], product?: string[], document_type?: string,',
      '                  amounts?: number[], dates?: string[] },',
      '     intent_hint?: string (ex: "product_inquiry", "complaint", "payment_proof", "id_document") }',
      captionFromMeta ? `\nLegenda do cliente: "${captionFromMeta}"` : '',
      'Retorne APENAS JSON puro com este shape: {"ai_summary": "...", "ai_extracted": {...}}',
    ].join('\n');

    let aiSummary: string | null = null;
    let aiExtracted: Record<string, unknown> | null = null;
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const sourceBlock =
        att.media_type === 'image'
          ? {
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: base64 },
            }
          : {
              type: 'document' as const,
              source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 },
            };

      const res = await this.getClient().messages.create({
        model: VISION_MODEL,
        max_tokens: 800,
        messages: [
          {
            role: 'user',
            content: [sourceBlock, { type: 'text', text: userPrompt }],
          },
        ],
      });

      inputTokens = res.usage.input_tokens;
      outputTokens = res.usage.output_tokens;

      const block = res.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      const text = block?.text?.trim() ?? '';
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      try {
        const parsed = JSON.parse(cleaned) as {
          ai_summary?: unknown;
          ai_extracted?: unknown;
        };
        aiSummary = typeof parsed.ai_summary === 'string' ? parsed.ai_summary : null;
        aiExtracted =
          parsed.ai_extracted && typeof parsed.ai_extracted === 'object'
            ? (parsed.ai_extracted as Record<string, unknown>)
            : null;
      } catch {
        // Falhou JSON — usa raw text como summary
        aiSummary = text.slice(0, 280);
        aiExtracted = { raw: text.slice(0, 1000) };
      }
    } catch (err) {
      this.logger.warn(
        `att ${att.id} vision falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.markProcessed(att.id, {
        ai_summary: null,
        ai_extracted: {
          error: err instanceof Error ? err.message : String(err),
          stage: 'vision',
        },
      });
      return;
    }

    await this.markProcessed(att.id, {
      ai_summary: aiSummary,
      ai_extracted: aiExtracted,
    });

    // Loga custo em ai_interactions (best-effort)
    const cost =
      (inputTokens * SONNET_INPUT_PER_MTOK + outputTokens * SONNET_OUTPUT_PER_MTOK) /
      1_000_000;
    void this.supabase.adminClient
      .from('ai_interactions')
      .insert({
        org_id: att.org_id,
        interaction_type: 'attachment_vision',
        model: VISION_MODEL,
        provider: 'anthropic',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
        latency_ms: Math.round(performance.now() - start),
        result_summary: (aiSummary ?? '').slice(0, 200),
        metadata: {
          source: 'attachments_worker',
          attachment_id: att.id,
          message_id: att.message_id,
          media_type: att.media_type,
        },
      })
      .then(() => {})
      .then(undefined, () => {});

    this.logger.log(
      `att ${att.id} processed (${att.media_type}) summary="${(aiSummary ?? '').slice(0, 60)}…"`,
    );
  }

  private async markProcessed(
    id: string,
    payload: { ai_summary: string | null; ai_extracted: Record<string, unknown> | null },
  ): Promise<void> {
    await this.supabase.adminClient
      .from('attachments')
      .update({
        ai_summary: payload.ai_summary,
        ai_extracted: payload.ai_extracted,
        ai_processed_at: new Date().toISOString(),
      })
      .eq('id', id);
  }

  /**
   * Gera signed URL pra UI baixar/exibir o blob. TTL configurável,
   * default 30min.
   */
  async getSignedUrl(storagePath: string, ttlSeconds = SIGNED_URL_TTL_SECONDS): Promise<string | null> {
    const { data, error } = await this.supabase.adminClient.storage
      .from('message-media')
      .createSignedUrl(storagePath, ttlSeconds);
    if (error || !data) {
      this.logger.warn(
        `getSignedUrl falhou (${storagePath}): ${error?.message ?? 'sem dados'}`,
      );
      return null;
    }
    return data.signedUrl;
  }

  /**
   * Lista attachments de uma conversa com signed URLs prontos pra UI.
   */
  async listForConversation(
    orgId: string,
    conversationId: string,
  ): Promise<
    Array<{
      id: string;
      message_id: string;
      media_type: string;
      mime_type: string | null;
      file_name: string | null;
      file_size_bytes: number | null;
      ai_summary: string | null;
      ai_extracted: Record<string, unknown> | null;
      url: string | null;
      created_at: string;
    }>
  > {
    const { data } = await this.supabase.adminClient
      .from('attachments')
      .select(
        'id, message_id, media_type, mime_type, file_name, file_size_bytes, storage_path, ai_summary, ai_extracted, created_at',
      )
      .eq('org_id', orgId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    const rows = (data ?? []) as Array<{
      id: string;
      message_id: string;
      media_type: string;
      mime_type: string | null;
      file_name: string | null;
      file_size_bytes: number | null;
      storage_path: string;
      ai_summary: string | null;
      ai_extracted: Record<string, unknown> | null;
      created_at: string;
    }>;

    return Promise.all(
      rows.map(async (r) => {
        const url = await this.getSignedUrl(r.storage_path);
        const out = {
          id: r.id,
          message_id: r.message_id,
          media_type: r.media_type,
          mime_type: r.mime_type,
          file_name: r.file_name,
          file_size_bytes: r.file_size_bytes,
          ai_summary: r.ai_summary,
          ai_extracted: r.ai_extracted,
          url,
          created_at: r.created_at,
        };
        return out;
      }),
    );
  }
}
