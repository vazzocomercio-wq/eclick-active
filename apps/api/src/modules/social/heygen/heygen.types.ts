/**
 * HeyGen — texto-para-vídeo com avatar a partir do roteiro de uma pauta.
 * Espelha active.heygen_jobs (migration 103) + shapes da API v2 do HeyGen.
 */

export type HeyGenJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface HeyGenDimension {
  width: number;
  height: number;
}

export interface HeyGenJob {
  id: string;
  org_id: string;
  brief_id: string | null;
  avatar_id: string | null;
  voice_id: string | null;
  template_id: string | null;
  title: string | null;
  script: string;
  dimension: HeyGenDimension;
  heygen_video_id: string | null;
  status: HeyGenJobStatus;
  video_url: string | null;
  thumbnail_url: string | null;
  duration_sec: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** Avatar do catálogo HeyGen (GET /v2/avatars). */
export interface HeyGenAvatar {
  avatar_id: string;
  name: string | null;
  gender: string | null;
  preview_image_url: string | null;
  premium: boolean;
}

/** Voz do catálogo HeyGen (GET /v2/voices). */
export interface HeyGenVoice {
  voice_id: string;
  name: string | null;
  language: string | null;
  gender: string | null;
  preview_audio: string | null;
}

/**
 * Template do HeyGen (GET /v2/templates): "ambiente fixo" montado no Studio
 * (avatar + voz + fundo + cena), com a fala marcada como variável. A automação
 * gera SEMPRE nesse ambiente, passando só o roteiro.
 */
export interface HeyGenTemplate {
  template_id: string;
  name: string | null;
  thumbnail_image_url: string | null;
}

/** Opções pro modal de criação (avatares + vozes + templates + se está ligado). */
export interface HeyGenOptions {
  configured: boolean;
  avatars: HeyGenAvatar[];
  voices: HeyGenVoice[];
  templates: HeyGenTemplate[];
}

// ─── DTOs ─────────────────────────────────────────

export interface CreateHeyGenJobDto {
  /** pauta-fonte: usa o roteiro (script) e título dela. */
  brief_id?: string;
  /** roteiro cru (alternativa ao brief_id). */
  script?: string;
  title?: string;
  /**
   * Modo TEMPLATE: gera a partir de um template do Studio (avatar/voz/fundo já
   * fixos nele) — o roteiro entra na variável de texto. Quando setado, avatar_id
   * e voice_id são ignorados.
   */
  template_id?: string;
  /** Modo avulso: avatar + voz escolhidos na hora (quando não há template_id). */
  avatar_id?: string;
  voice_id?: string;
  /** sobrescreve a dimensão inferida do formato da pauta (ignorado no template). */
  width?: number;
  height?: number;
}
