import { api } from './client';

// ── Tipos (espelham active.social_youtube_publications) ─────

export type YTPrivacy = 'public' | 'unlisted' | 'private';
export type YTPublicationStatus = 'draft' | 'publishing' | 'published' | 'failed';

export interface YTChapter {
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
  privacy: YTPrivacy;
  chapters: YTChapter[];
  thumbnail_url: string | null;
  thumbnail_storage_path: string | null;
  status: YTPublicationStatus;
  youtube_video_id: string | null;
  youtube_url: string | null;
  published_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface YTChannel {
  id: string;
  youtube_channel_id: string;
  title: string | null;
  thumbnail_url: string | null;
}

export interface UpdateYTDraftPayload {
  title?: string;
  description?: string;
  tags?: string[];
  category_id?: string;
  privacy?: YTPrivacy;
  chapters?: YTChapter[];
  channel_cred_id?: string | null;
}

const BASE = '/studio-cortes/youtube/longform';

export const ytLongformApi = {
  /** Gera (ou recupera) o rascunho de publicação a partir de um vídeo HeyGen. */
  draft: (payload: { heygen_job_id?: string; source_video_url?: string; title?: string; regenerate?: boolean }) =>
    api.post<YouTubePublication>(`${BASE}/draft`, payload),

  get: (id: string) => api.get<YouTubePublication>(`${BASE}/publications/${id}`),

  update: (id: string, patch: UpdateYTDraftPayload) =>
    api.patch<YouTubePublication>(`${BASE}/publications/${id}`, patch),

  /** Regenera só a miniatura. */
  regenerateThumbnail: (id: string) =>
    api.post<YouTubePublication>(`${BASE}/publications/${id}/thumbnail`, {}),

  /** Publica de fato no YouTube (sobe vídeo + capa). Ação explícita. */
  publish: (id: string, channelCredId?: string | null) =>
    api.post<YouTubePublication>(`${BASE}/publications/${id}/publish`, { channel_cred_id: channelCredId ?? null }),

  /** Canais conectados (reusa o multi-canal do Studio de Cortes). */
  channels: () => api.get<YTChannel[]>('/studio-cortes/youtube/channels'),
};
