import { Injectable, Logger } from '@nestjs/common';
import type {
  HeyGenAvatar,
  HeyGenDimension,
  HeyGenTemplate,
  HeyGenVoice,
} from './heygen.types';

/** Variável de um template (GET /v2/template/{id}) — tipo + valor atual. */
export interface HeyGenTemplateVariable {
  name: string;
  type: string; // text | image | video | audio …
}

const HEYGEN_BASE = 'https://api.heygen.com';
/** Limite de texto por cena no /v2/video/generate — chunkamos abaixo disso. */
export const HEYGEN_SCENE_CHAR_LIMIT = 1450;

interface HeyGenEnvelope<T> {
  error?: { code?: string; message?: string } | string | null;
  data?: T;
  message?: string;
  code?: number;
}

export interface HeyGenStatusResult {
  status: string; // waiting|pending|processing|completed|failed
  video_url: string | null;
  thumbnail_url: string | null;
  duration_sec: number | null;
  error: string | null;
}

/**
 * Cliente direto da API v2 do HeyGen (auth por X-Api-Key). Best-effort: sem
 * HEYGEN_API_KEY a integração fica desligada (isConfigured()=false) e os métodos
 * lançam erro acionável em PT-BR. NÃO logamos a key.
 *
 * Contrato v2 (suportado até out/2026):
 *   POST /v2/video/generate   { video_inputs[], dimension } → { data: { video_id } }
 *   GET  /v1/video_status.get?video_id=…                    → { data: { status, video_url, … } }
 *   GET  /v2/avatars                                        → { data: { avatars[] } }
 *   GET  /v2/voices                                         → { data: { voices[] } }
 */
@Injectable()
export class HeyGenProvider {
  private readonly log = new Logger(HeyGenProvider.name);

  isConfigured(): boolean {
    return !!process.env.HEYGEN_API_KEY;
  }

  private key(): string {
    const k = process.env.HEYGEN_API_KEY;
    if (!k) {
      throw new Error(
        'HEYGEN_API_KEY ausente — configure a chave do HeyGen na active-api pra gerar vídeos com avatar.',
      );
    }
    return k;
  }

  private async call<T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
  ): Promise<T> {
    const res = await fetch(`${HEYGEN_BASE}${path}`, {
      method: init.method,
      headers: {
        'X-Api-Key': this.key(),
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let json: HeyGenEnvelope<T>;
    try {
      json = text ? (JSON.parse(text) as HeyGenEnvelope<T>) : {};
    } catch {
      throw new Error(`HeyGen ${path} resposta inválida (${res.status}): ${text.slice(0, 200)}`);
    }
    const errMsg =
      typeof json.error === 'string'
        ? json.error
        : json.error?.message ?? null;
    if (!res.ok || errMsg) {
      throw new Error(`HeyGen ${path} falhou (${res.status}): ${errMsg ?? text.slice(0, 200)}`);
    }
    return json.data as T;
  }

  /** Cria o vídeo a partir das cenas (cada cena = um trecho do roteiro). */
  async createVideo(
    scenes: string[],
    avatarId: string,
    voiceId: string,
    dimension: HeyGenDimension,
  ): Promise<string> {
    const video_inputs = scenes.map((input_text) => ({
      character: { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
      voice: { type: 'text', input_text, voice_id: voiceId },
    }));
    const data = await this.call<{ video_id: string }>('/v2/video/generate', {
      method: 'POST',
      body: { video_inputs, dimension },
    });
    if (!data?.video_id) {
      throw new Error('HeyGen não retornou video_id.');
    }
    return data.video_id;
  }

  async getStatus(videoId: string): Promise<HeyGenStatusResult> {
    const data = await this.call<{
      status: string;
      video_url?: string | null;
      video_url_caption?: string | null;
      thumbnail_url?: string | null;
      duration?: number | null;
      error?: { message?: string; detail?: string } | string | null;
    }>(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`);
    const err =
      typeof data.error === 'string'
        ? data.error
        : data.error?.message ?? data.error?.detail ?? null;
    return {
      status: data.status ?? 'processing',
      video_url: data.video_url ?? null,
      thumbnail_url: data.thumbnail_url ?? null,
      duration_sec: typeof data.duration === 'number' ? data.duration : null,
      error: err,
    };
  }

  async listAvatars(): Promise<HeyGenAvatar[]> {
    const data = await this.call<{
      avatars?: Array<{
        avatar_id: string;
        avatar_name?: string;
        gender?: string;
        preview_image_url?: string;
        premium?: boolean;
      }>;
    }>('/v2/avatars');
    return (data?.avatars ?? []).map((a) => ({
      avatar_id: a.avatar_id,
      name: a.avatar_name ?? null,
      gender: a.gender ?? null,
      preview_image_url: a.preview_image_url ?? null,
      premium: !!a.premium,
    }));
  }

  async listVoices(): Promise<HeyGenVoice[]> {
    const data = await this.call<{
      voices?: Array<{
        voice_id: string;
        name?: string;
        language?: string;
        gender?: string;
        preview_audio?: string;
      }>;
    }>('/v2/voices');
    return (data?.voices ?? []).map((v) => ({
      voice_id: v.voice_id,
      name: v.name ?? null,
      language: v.language ?? null,
      gender: v.gender ?? null,
      preview_audio: v.preview_audio ?? null,
    }));
  }

  // ─── Templates (ambiente fixo montado no Studio) ───────────────

  async listTemplates(): Promise<HeyGenTemplate[]> {
    const data = await this.call<{
      templates?: Array<{
        template_id: string;
        name?: string;
        thumbnail_image_url?: string;
      }>;
    }>('/v2/templates');
    return (data?.templates ?? []).map((t) => ({
      template_id: t.template_id,
      name: t.name ?? null,
      thumbnail_image_url: t.thumbnail_image_url ?? null,
    }));
  }

  /** Variáveis declaradas no template (pra saber onde injetar o roteiro). */
  async getTemplateVariables(templateId: string): Promise<HeyGenTemplateVariable[]> {
    const data = await this.call<{
      variables?: Record<string, { name?: string; type?: string }>;
    }>(`/v2/template/${encodeURIComponent(templateId)}`);
    const vars = data?.variables ?? {};
    return Object.entries(vars).map(([key, v]) => ({
      name: v?.name ?? key,
      type: v?.type ?? 'text',
    }));
  }

  /**
   * Gera a partir de um template, preenchendo as variáveis de texto com o
   * roteiro. `variables` mapeia nome→conteúdo. Dimensão é opcional (o template
   * já define o layout); só enviamos se vier explícita.
   */
  async generateFromTemplate(
    templateId: string,
    variables: Record<string, string>,
    dimension?: HeyGenDimension,
    title?: string,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      test: false,
      caption: false,
      variables: Object.fromEntries(
        Object.entries(variables).map(([name, content]) => [
          name,
          { name, type: 'text', properties: { content } },
        ]),
      ),
    };
    if (dimension) body.dimension = dimension;
    if (title) body.title = title.slice(0, 200);
    const data = await this.call<{ video_id: string }>(
      `/v2/template/${encodeURIComponent(templateId)}/generate`,
      { method: 'POST', body },
    );
    if (!data?.video_id) {
      throw new Error('HeyGen (template) não retornou video_id.');
    }
    return data.video_id;
  }
}
