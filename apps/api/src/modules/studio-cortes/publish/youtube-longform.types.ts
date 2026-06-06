/**
 * Tipos da publicação de VÍDEO LONGO no YouTube (a partir de um vídeo HeyGen
 * do Radar ou de uma URL de mp4). Espelha active.social_youtube_publications.
 */

export type YouTubePublicationStatus = 'draft' | 'publishing' | 'published' | 'failed';
export type YouTubePrivacy = 'public' | 'unlisted' | 'private';

export interface YouTubeChapter {
  /** Timestamp no formato mm:ss ou h:mm:ss (o 1º DEVE ser 0:00). */
  t: string;
  label: string;
}

export interface YouTubePublication {
  id: string;
  org_id: string;
  heygen_job_id: string | null;
  source_video_url: string;
  channel_cred_id: string | null;
  title: string;
  description: string;
  tags: string[];
  category_id: string;
  privacy: YouTubePrivacy;
  chapters: YouTubeChapter[];
  thumbnail_url: string | null;
  thumbnail_storage_path: string | null;
  status: YouTubePublicationStatus;
  youtube_video_id: string | null;
  youtube_url: string | null;
  published_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface GenerateDraftDto {
  /** Origem preferida: vídeo gerado no HeyGen (Radar). */
  heygen_job_id?: string;
  /** Alternativa: URL direta de um mp4 (quando não vem do HeyGen). */
  source_video_url?: string;
  /** Sobrescreve o título-base usado pra gerar os metadados. */
  title?: string;
  /** Força regenerar metadados/miniatura mesmo se já existir rascunho. */
  regenerate?: boolean;
}

export interface UpdateDraftDto {
  title?: string;
  description?: string;
  tags?: string[];
  category_id?: string;
  privacy?: YouTubePrivacy;
  chapters?: YouTubeChapter[];
  channel_cred_id?: string | null;
}
