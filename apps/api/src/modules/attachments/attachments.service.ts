import { Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { LlmService } from '../../common/llm/llm.service';
import type { LlmContentBlock } from '../../common/llm/llm-provider.interface';

const WHISPER_MODEL = 'whisper-1';
const SIGNED_URL_TTL_SECONDS = 60 * 30; // 30min — UI usa pra exibir mídia
const WHISPER_MAX_BYTES = 24 * 1024 * 1024; // 25MB limite OpenAI; deixa folga

/** Whisper preço fixo por minuto (USD). */
const WHISPER_USD_PER_MIN = 0.006;

/** Mapeia mime de áudio comum pra extensão aceita pelo Whisper. */
function mimeToWhisperExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('mp3') || m.includes('mpeg')) return 'mp3';
  if (m.includes('m4a') || m.includes('mp4')) return 'm4a';
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('webm')) return 'webm';
  return 'ogg'; // default razoável (Baileys WhatsApp manda audio/ogg geralmente)
}

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

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
  ) {}

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

    // Document: por enquanto só PDF (Vision aceita PDF nativo). Outros tipos skipa.
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

    // Audio → Whisper direto. Vídeo → extrai trilha de áudio com ffmpeg
    // e manda pro Whisper. Em ambos casos, fluxo de transcript +
    // resumo via Sonnet é compartilhado em processAudioWithWhisper.
    if (att.media_type === 'audio') {
      await this.processAudioWithWhisper(att, buffer, start);
      return;
    }

    if (att.media_type === 'video') {
      const audioBuf = await this.extractAudioFromVideo(buffer, att.id).catch(
        (err: unknown) => {
          this.logger.warn(
            `att ${att.id} ffmpeg extract falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        },
      );
      if (!audioBuf) {
        await this.markProcessed(att.id, {
          ai_summary: null,
          ai_extracted: {
            error: 'ffmpeg failed to extract audio',
            stage: 'video_extract',
          },
        });
        return;
      }
      // Reusa pipeline de áudio com mime forçado pra ogg (formato extraído).
      await this.processAudioWithWhisper(
        { ...att, mime_type: 'audio/ogg' },
        audioBuf,
        start,
      );
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

    try {
      const mediaBlock: LlmContentBlock =
        att.media_type === 'image'
          ? { type: 'image_base64', media_type: mediaType, data: base64 }
          : { type: 'pdf_base64', data: base64 };

      const res = await this.llm.chat({
        orgId: att.org_id,
        feature: 'attachment_vision',
        system: 'Você analisa mídia inbound de WhatsApp e devolve JSON.',
        user: [
          {
            role: 'user',
            content: [mediaBlock, { type: 'text', text: userPrompt }],
          },
        ],
        max_tokens: 800,
        json_mode: true,
        metadata: {
          source: 'attachments_worker',
          attachment_id: att.id,
          message_id: att.message_id,
          media_type: att.media_type,
        },
      });

      const text = res.text;
      const parsed = parseVisionJson(text);
      aiSummary = parsed.ai_summary;
      aiExtracted = parsed.ai_extracted;
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

    this.logger.log(
      `att ${att.id} processed (${att.media_type}) summary="${(aiSummary ?? '').slice(0, 60)}…"`,
    );
  }

  /**
   * Extrai trilha de áudio de um buffer de vídeo via ffmpeg-static.
   * Output: ogg/opus mono 16kHz (formato leve, ideal pra Whisper). Usa
   * arquivos temp porque ffmpeg trabalha com paths reais.
   *
   * Lança Error se ffmpeg falhar (caller decide o fallback).
   */
  private async extractAudioFromVideo(
    videoBuf: Buffer,
    attachmentId: string,
  ): Promise<Buffer> {
    const ff = ffmpegPath as unknown as string | null;
    if (!ff) throw new Error('ffmpeg-static não disponível');

    const dir = await mkdtemp(join(tmpdir(), 'eclick-att-'));
    const inputPath = join(dir, `in-${attachmentId}.bin`);
    const outputPath = join(dir, `out-${attachmentId}.ogg`);

    try {
      await writeFile(inputPath, videoBuf);

      // -vn = sem video; -ac 1 = mono; -ar 16k = 16kHz; -c:a libopus = codec opus
      // -b:a 24k = bitrate baixo (Whisper aceita bem); -y = sobrescreve
      const args = [
        '-i', inputPath,
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-c:a', 'libopus',
        '-b:a', '24k',
        '-y',
        outputPath,
      ];

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ff, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        proc.on('error', (err) => reject(err));
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`));
        });
      });

      return await readFile(outputPath);
    } finally {
      // Cleanup temp dir mesmo se ffmpeg falhar — evita lixo no /tmp
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Áudio inbound — transcreve via OpenAI Whisper (whisper-1). Limita a
   * 25MB. Se mídia maior, marca como skipped com motivo. Após transcript,
   * dispara Anthropic Sonnet pra resumir + extrair entities estruturadas
   * (semelhante ao Vision pra imagens).
   */
  private async processAudioWithWhisper(
    att: AttachmentRow,
    buffer: Buffer,
    startTs: number,
  ): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      this.logger.warn(`att ${att.id} audio: OPENAI_API_KEY ausente — skip`);
      await this.markProcessed(att.id, {
        ai_summary: null,
        ai_extracted: { skipped: true, reason: 'OPENAI_API_KEY not configured' },
      });
      return;
    }

    if (buffer.length > WHISPER_MAX_BYTES) {
      await this.markProcessed(att.id, {
        ai_summary: null,
        ai_extracted: {
          skipped: true,
          reason: `file too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB > 25MB Whisper limit)`,
        },
      });
      return;
    }

    // Whisper aceita: mp3, mp4, mpeg, mpga, m4a, wav, webm, opus, ogg
    const mime = att.mime_type ?? 'audio/ogg';
    const ext = mimeToWhisperExt(mime);
    const fileName = att.file_name ?? `audio-${att.id}.${ext}`;

    let transcript = '';
    try {
      // Node 20+ tem FormData nativa
      const form = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: mime });
      form.append('file', blob, fileName);
      form.append('model', WHISPER_MODEL);
      form.append('language', 'pt');
      form.append('response_format', 'verbose_json');

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Whisper ${res.status}: ${errBody.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        text?: string;
        duration?: number;
        language?: string;
      };
      transcript = (json.text ?? '').trim();
      // Loga custo aproximado
      const minutes = (json.duration ?? 0) / 60;
      const cost = minutes * WHISPER_USD_PER_MIN;
      void this.supabase.adminClient
        .from('ai_interactions')
        .insert({
          org_id: att.org_id,
          interaction_type: 'attachment_transcribe',
          model: WHISPER_MODEL,
          provider: 'openai',
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
          latency_ms: Math.round(performance.now() - startTs),
          result_summary: transcript.slice(0, 200),
          metadata: {
            source: 'attachments_worker',
            attachment_id: att.id,
            message_id: att.message_id,
            duration_seconds: json.duration ?? 0,
            language: json.language ?? 'pt',
          },
        })
        .then(() => {})
        .then(undefined, () => {});
    } catch (err) {
      this.logger.warn(
        `att ${att.id} whisper falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.markProcessed(att.id, {
        ai_summary: null,
        ai_extracted: {
          error: err instanceof Error ? err.message : String(err),
          stage: 'whisper',
        },
      });
      return;
    }

    if (!transcript) {
      await this.markProcessed(att.id, {
        ai_summary: 'Áudio sem fala detectada.',
        ai_extracted: { type: 'audio', transcript: '', empty: true },
      });
      return;
    }

    // Resumo + extração via Sonnet a partir do transcript. Best-effort —
    // se falhar, ainda salvamos o transcript bruto como ai_summary.
    let aiSummary: string = transcript.slice(0, 280);
    let aiExtracted: Record<string, unknown> = {
      type: 'audio',
      transcript,
    };

    try {
      const res = await this.llm.chat({
        orgId: att.org_id,
        feature: 'attachment_audio_summary',
        system:
          'Você está analisando uma transcrição de áudio que um cliente enviou via WhatsApp. Tarefa: 1) Resumo em 1-2 frases pt-BR (ai_summary). 2) Entities estruturadas (ai_extracted). Retorne APENAS JSON: {"ai_summary":"...","ai_extracted":{...}}',
        user: `Transcrição:\n"""\n${transcript.slice(0, 4000)}\n"""\n\nGere o JSON.`,
        max_tokens: 500,
        json_mode: true,
        metadata: {
          source: 'attachments_worker',
          attachment_id: att.id,
          message_id: att.message_id,
        },
      });
      const parsed = parseVisionJson(res.text);
      if (parsed.ai_summary) aiSummary = parsed.ai_summary;
      if (parsed.ai_extracted) {
        aiExtracted = {
          type: 'audio',
          transcript,
          ...parsed.ai_extracted,
        };
      }
    } catch (err) {
      this.logger.warn(
        `att ${att.id} sonnet summary falhou (transcript salvo): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await this.markProcessed(att.id, {
      ai_summary: aiSummary,
      ai_extracted: aiExtracted,
    });

    this.logger.log(
      `att ${att.id} audio transcrito (${transcript.length} chars) summary="${aiSummary.slice(0, 60)}…"`,
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

/**
 * Parser robusto pro JSON de saída do Vision/audio summary.
 *
 * O LLM ocasionalmente retorna o JSON envolto em texto, com markdown
 * fences inconsistentes, ou com escape errado de aspas internas. Esse
 * helper tenta múltiplas estratégias antes de cair no fallback de
 * mostrar texto bruto:
 *
 *   1. JSON.parse direto (95% dos casos)
 *   2. Strip de fences ```json ... ```
 *   3. Substring entre primeiro `{` e último `}` que parseia
 *   4. Regex pra extrair `ai_summary` e `ai_extracted` separados
 *   5. Fallback: ai_summary = primeira linha legível (não JSON cru)
 */
export function parseVisionJson(text: string): {
  ai_summary: string | null;
  ai_extracted: Record<string, unknown> | null;
} {
  const tryParse = (s: string): { ai_summary?: unknown; ai_extracted?: unknown } | null => {
    try {
      return JSON.parse(s) as { ai_summary?: unknown; ai_extracted?: unknown };
    } catch {
      return null;
    }
  };

  // 1. Direto
  let parsed = tryParse(text.trim());

  // 2. Strip fences
  if (!parsed) {
    const stripped = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
    parsed = tryParse(stripped);
  }

  // 3. Substring {...}
  if (!parsed) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      parsed = tryParse(text.slice(firstBrace, lastBrace + 1));
    }
  }

  if (parsed) {
    return {
      ai_summary: typeof parsed.ai_summary === 'string' ? parsed.ai_summary : null,
      ai_extracted:
        parsed.ai_extracted && typeof parsed.ai_extracted === 'object'
          ? (parsed.ai_extracted as Record<string, unknown>)
          : null,
    };
  }

  // 4. Regex pra extrair ai_summary mesmo se JSON inválido global
  // Ex: text inválido com `"ai_summary": "frase aqui"` no meio
  const summaryMatch = /"ai_summary"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  if (summaryMatch?.[1]) {
    return {
      ai_summary: summaryMatch[1].replace(/\\"/g, '"').slice(0, 500),
      ai_extracted: { parser_fallback: 'regex_extracted', raw: text.slice(0, 1000) },
    };
  }

  // 5. Fallback final: nada salvo no ai_summary (UI mostra "IA está analisando")
  return {
    ai_summary: null,
    ai_extracted: { parser_failed: true, raw: text.slice(0, 1000) },
  };
}
