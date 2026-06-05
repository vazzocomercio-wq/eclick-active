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
  avatar_id: string;
  voice_id: string;
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

/** Opções pro modal de criação (avatares + vozes + se a integração está ligada). */
export interface HeyGenOptions {
  configured: boolean;
  avatars: HeyGenAvatar[];
  voices: HeyGenVoice[];
}

// ─── DTOs ─────────────────────────────────────────

export interface CreateHeyGenJobDto {
  /** pauta-fonte: usa o roteiro (script) e título dela. */
  brief_id?: string;
  /** roteiro cru (alternativa ao brief_id). */
  script?: string;
  title?: string;
  avatar_id: string;
  voice_id: string;
  /** sobrescreve a dimensão inferida do formato da pauta. */
  width?: number;
  height?: number;
}
