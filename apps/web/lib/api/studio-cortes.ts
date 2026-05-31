import { api } from './client';
import { createClient } from '../supabase/client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

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

  scheduleClip: (clipId: string, scheduledAt: string | null) =>
    api.patch<ClipRow>(`/studio-cortes/clips/${clipId}/schedule`, { scheduled_at: scheduledAt }),

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

  retryClip: (jobId: string) =>
    api.post<{ ok: true }>(`/studio-cortes/jobs/${jobId}/retry-clip`),

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

/**
 * Upload do master com progresso real (XHR — fetch não expõe upload.onprogress).
 * onProgress(pct 0-100, bytesEnviados, bytesTotal). Em pct=100 o servidor ainda
 * está subindo pro Drive + criando o job (fase "processando" até resolver).
 */
export async function uploadWithProgress(
  file: File,
  title: string | undefined,
  onProgress: (pct: number, loaded: number, total: number) => void,
): Promise<ContentJob> {
  let token: string | undefined;
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
  } catch {
    /* sem token → backend responde 401 */
  }

  return new Promise<ContentJob>((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL.replace(/\/$/, '')}/studio-cortes/upload`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as ContentJob);
        } catch {
          resolve({} as ContentJob);
        }
      } else {
        let msg = `HTTP ${xhr.status}`;
        try {
          const b = JSON.parse(xhr.responseText) as { message?: string };
          if (b?.message) msg = String(b.message);
        } catch {
          /* mantém HTTP n */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Falha de rede no upload'));
    xhr.ontimeout = () => reject(new Error('Tempo de upload esgotado'));
    xhr.send(form);
  });
}

export const CLIP_STATUS_ORDER: ClipStatus[] = [
  'a_revisar',
  'aprovado',
  'agendado',
  'publicado',
  'falhou',
];

/**
 * Colunas que aceitam arraste manual. "Agendado" sai daqui porque exige um
 * horário (vai pelo botão Agendar no painel); "Publicado"/"Falhou" são automáticos.
 */
export const DROPPABLE_STATUSES: ClipStatus[] = ['a_revisar', 'aprovado'];
