// ═══════════════════════════════════════════════════
// Studio de Cortes — tipos do domínio (Migration 094)
// ═══════════════════════════════════════════════════

export type JobSourceType = 'upload' | 'youtube' | 'drive';

export type JobStatus =
  | 'received'
  | 'fetching'
  | 'clipping'
  | 'generating_copy'
  | 'in_review'
  | 'publishing'
  | 'done'
  | 'failed';

export type ClipStatus =
  | 'a_revisar'
  | 'aprovado'
  | 'agendado'
  | 'publicado'
  | 'falhou';

export type ClipPlatform = 'instagram' | 'tiktok' | 'youtube';

export type ClipPostStatus = 'rascunho' | 'agendado' | 'publicado' | 'falhou';

export interface ContentJob {
  id: string;
  org_id: string;
  title: string | null;
  source_type: JobSourceType;
  drive_file_id: string | null;
  drive_folder_id: string | null;
  youtube_video_id: string | null;
  resolution: string | null;
  status: JobStatus;
  failure_reason: string | null;
  clipping_provider: string | null;
  clipping_job_id: string | null;
  transcript: string | null;
  auto_approve: boolean;
  master_deleted_at: string | null;
  created_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Clip {
  id: string;
  job_id: string;
  org_id: string;
  provider_clip_id: string | null;
  title: string | null;
  file_url: string | null;
  drive_file_id: string | null;
  duration_seconds: number | null;
  start_seconds: number | null;
  end_seconds: number | null;
  width: number | null;
  height: number | null;
  thumbnail_url: string | null;
  transcript: string | null;
  hook: string | null;
  status: ClipStatus;
  work_file_deleted_at: string | null;
  order_index: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ClipPost {
  id: string;
  clip_id: string;
  org_id: string;
  platform: ClipPlatform;
  account_id: string | null;
  enabled: boolean;
  title: string | null;
  copy: string | null;
  hashtags: string[];
  scheduled_at: string | null;
  external_post_id: string | null;
  status: ClipPostStatus;
  metrics: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ClipWithPosts extends Clip {
  posts: ClipPost[];
}

export interface JobWithClips extends ContentJob {
  clips: ClipWithPosts[];
}

// ─── Contrato dos provedores de corte ──────────────

/** Um corte devolvido pelo provedor (Vizard, etc). */
export interface ProviderClip {
  provider_clip_id: string;
  title?: string;
  file_url?: string;
  thumbnail_url?: string;
  duration_seconds?: number;
  start_seconds?: number;
  end_seconds?: number;
  width?: number;
  height?: number;
  transcript?: string;
  hook?: string;
  /** Extras do provedor (viral score, etc) — vão pra clips.metadata. */
  extra?: Record<string, unknown>;
}

export interface ClippingSubmitOptions {
  /** id do content_job — vai como projectName/idempotência. */
  jobId: string;
  /** URL pública (assinada) do master no Drive, OU URL do YouTube. */
  webhookUrl?: string;
  language?: string;
  /** Tipo da fonte pro provedor (remoto vs youtube). */
  sourceType?: JobSourceType;
}

export interface ClippingSubmitResult {
  clipping_job_id: string;
}

export interface ParsedClipping {
  clipping_job_id: string;
  state: 'completed' | 'processing' | 'failed';
  transcript?: string;
  clips: ProviderClip[];
  error?: string;
}

/**
 * Provedor de corte pluggable. Implementações: VizardProvider (default).
 *   - submit: manda o master pro provedor, devolve o id do job remoto.
 *   - parseWebhook: traduz o payload do webhook de conclusão.
 *   - poll: usado pelo reconciler (fallback se o webhook não chegar).
 */
export interface ClippingProvider {
  readonly name: string;
  submit(sourceUrl: string, opts: ClippingSubmitOptions): Promise<ClippingSubmitResult>;
  parseWebhook(payload: unknown): ParsedClipping | null;
  poll(clippingJobId: string): Promise<ParsedClipping | null>;
}

export const CLIPPING_PROVIDER = Symbol('CLIPPING_PROVIDER');
