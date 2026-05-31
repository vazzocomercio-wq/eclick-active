import { api } from './client';

// ── Tipos (espelham active.* da Migration 094) ──────────────

export type ClipStatus = 'a_revisar' | 'aprovado' | 'agendado' | 'publicado' | 'falhou';
export type ClipPlatform = 'instagram' | 'tiktok' | 'youtube';
export type ClipPostStatus = 'rascunho' | 'agendado' | 'publicado' | 'falhou';
export type JobStatus =
  | 'received'
  | 'fetching'
  | 'clipping'
  | 'generating_copy'
  | 'in_review'
  | 'publishing'
  | 'done'
  | 'failed';

export interface ClipPostMetrics {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  fetched_at?: string;
}

export interface ClipPost {
  id: string;
  clip_id: string;
  org_id: string;
  platform: ClipPlatform;
  account_id: string | null;
  title: string | null;
  copy: string | null;
  hashtags: string[];
  scheduled_at: string | null;
  external_post_id: string | null;
  external_post_url: string | null;
  published_at: string | null;
  error: string | null;
  status: ClipPostStatus;
  metrics: ClipPostMetrics;
  created_at: string;
  updated_at: string;
}

export interface MetricsSummary {
  by_platform: Array<{
    platform: ClipPlatform;
    posts: number;
    views: number;
    likes: number;
    comments: number;
    shares: number;
  }>;
}

export interface ClipJobRef {
  id: string;
  title: string | null;
  status: JobStatus;
  source_type: string;
}

export interface ClipRow {
  id: string;
  job_id: string;
  org_id: string;
  provider_clip_id: string | null;
  title: string | null;
  file_url: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  thumbnail_url: string | null;
  transcript: string | null;
  hook: string | null;
  status: ClipStatus;
  order_index: number;
  created_at: string;
  updated_at: string;
  posts: ClipPost[];
  job: ClipJobRef | null;
}

export type BoardColumns = Record<ClipStatus, ClipRow[]>;

export interface ContentJob {
  id: string;
  org_id: string;
  title: string | null;
  source_type: string;
  status: JobStatus;
  failure_reason: string | null;
  clipping_provider: string | null;
  auto_approve: boolean;
  created_at: string;
  updated_at: string;
}

export interface CortesConfig {
  drive_connected: boolean;
  drive_email: string | null;
  youtube_ready: boolean;
  vizard_configured: boolean;
  platforms: ClipPlatform[];
}

// ── API ─────────────────────────────────────────────────────

export const cortesApi = {
  config: () => api.get<CortesConfig>('/studio-cortes/config'),

  googleConnect: () => api.get<{ url: string }>('/studio-cortes/google/connect'),
  googleStatus: () =>
    api.get<{ connected: boolean; email: string | null }>('/studio-cortes/google/status'),
  googleDisconnect: () => api.post<{ ok: true }>('/studio-cortes/google/disconnect'),

  board: () => api.get<{ columns: BoardColumns }>('/studio-cortes/board'),

  jobs: () => api.get<ContentJob[]>('/studio-cortes/jobs'),

  upload: (file: File, title?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);
    return api.post<ContentJob>('/studio-cortes/upload', form);
  },

  setClipStatus: (clipId: string, status: ClipStatus) =>
    api.patch<ClipRow>(`/studio-cortes/clips/${clipId}/status`, { status }),

  updatePost: (
    postId: string,
    patch: {
      title?: string | null;
      copy?: string | null;
      hashtags?: string[];
      scheduled_at?: string | null;
      account_id?: string | null;
    },
  ) => api.patch<ClipPost>(`/studio-cortes/posts/${postId}`, patch),

  updateJob: (jobId: string, patch: { auto_approve?: boolean; title?: string }) =>
    api.patch<ContentJob>(`/studio-cortes/jobs/${jobId}`, patch),

  regenerateCopy: (jobId: string) =>
    api.post<{ generated: number }>(`/studio-cortes/jobs/${jobId}/regenerate-copy`),

  runJanitor: () =>
    api.post<{
      masters_deleted: number;
      workfiles_deleted: number;
      quota_percent: number | null;
      alerted: boolean;
    }>('/studio-cortes/janitor/run'),

  metrics: () => api.get<MetricsSummary>('/studio-cortes/metrics'),
  refreshMetrics: () => api.post<{ updated: number }>('/studio-cortes/metrics/refresh'),
};

export const CLIP_STATUS_ORDER: ClipStatus[] = [
  'a_revisar',
  'aprovado',
  'agendado',
  'publicado',
  'falhou',
];

/** Colunas pra onde o usuário pode arrastar no Sprint 1 (publicação = Sprint 2). */
export const DROPPABLE_STATUSES: ClipStatus[] = ['a_revisar', 'aprovado', 'agendado'];
