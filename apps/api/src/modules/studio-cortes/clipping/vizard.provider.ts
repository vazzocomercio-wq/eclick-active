import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type {
  ClippingProvider,
  ClippingSubmitOptions,
  ClippingSubmitResult,
  ParsedClipping,
  ProviderClip,
} from '../studio-cortes.types';

/**
 * Provedor de corte padrão: Vizard.ai (open API).
 *
 * Doc: manda o vídeo (URL remota ou YouTube) → Vizard processa → devolve N
 * cortes 9:16 (1080×1920) com transcrição, título e viral score. Conclusão via
 * webhook (preferido) e/ou polling (`poll`, usado pelo reconciler).
 *
 * Env: VIZARD_API_KEY. Sem ela, submit/poll falham com mensagem clara (o resto
 * do pipeline e o tsc continuam funcionando — gating é só em runtime).
 */

const VIZARD_BASE = 'https://elb-api.vizard.ai/hvizard-server-front/open-api/v1';
// Vizard videoType: 1 = arquivo remoto, 2 = YouTube.
const VIDEO_TYPE_REMOTE = 1;
const VIDEO_TYPE_YOUTUBE = 2;

interface VizardVideo {
  videoId?: number | string;
  videoUrl?: string;
  title?: string;
  transcript?: string;
  viralScore?: number | string;
  viralReason?: string;
  relatedTopic?: string;
  clipEditorUrl?: string;
  videoMsDuration?: number;
}

interface VizardResult {
  code?: number;
  projectId?: number | string;
  videos?: VizardVideo[];
  errMsg?: string;
}

@Injectable()
export class VizardProvider implements ClippingProvider {
  readonly name = 'vizard';
  private readonly log = new Logger(VizardProvider.name);

  private apiKey(): string {
    const key = process.env.VIZARD_API_KEY?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        'VIZARD_API_KEY não configurada no Railway active-api. Setar a chave da Vizard pra cortar vídeos.',
      );
    }
    return key;
  }

  async submit(sourceUrl: string, opts: ClippingSubmitOptions): Promise<ClippingSubmitResult> {
    const res = await fetch(`${VIZARD_BASE}/project/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', VIZARDAI_API_KEY: this.apiKey() },
      body: JSON.stringify({
        lang: opts.language ?? 'pt',
        videoUrl: sourceUrl,
        videoType: opts.sourceType === 'youtube' ? VIDEO_TYPE_YOUTUBE : VIDEO_TYPE_REMOTE,
        ext: 'mp4',
        preferLength: [0], // auto
        projectName: `cortes-${opts.jobId}`,
        subtitleSwitch: 1,
        headlineSwitch: 1,
        ...(opts.webhookUrl ? { webhookUrl: opts.webhookUrl } : {}),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as VizardResult;
    if (!res.ok || !json.projectId) {
      throw new ServiceUnavailableException(
        `Vizard create falhou (HTTP ${res.status}): ${json.errMsg ?? JSON.stringify(json).slice(0, 200)}`,
      );
    }
    this.log.log(`[vizard] job ${opts.jobId} → projectId=${json.projectId}`);
    return { clipping_job_id: String(json.projectId) };
  }

  parseWebhook(payload: unknown): ParsedClipping | null {
    const body = payload as VizardResult | null;
    if (!body || body.projectId === undefined || body.projectId === null) return null;
    const clippingJobId = String(body.projectId);
    // code Vizard: 2000 = concluído, 1000 = processando, demais = erro.
    if (body.code === 2000) {
      return {
        clipping_job_id: clippingJobId,
        state: 'completed',
        clips: this.mapClips(clippingJobId, body.videos ?? []),
      };
    }
    if (body.code === 1000 || body.code === undefined) {
      return { clipping_job_id: clippingJobId, state: 'processing', clips: [] };
    }
    return {
      clipping_job_id: clippingJobId,
      state: 'failed',
      clips: [],
      error: body.errMsg ?? `Vizard code=${body.code}`,
    };
  }

  async poll(clippingJobId: string): Promise<ParsedClipping | null> {
    const res = await fetch(`${VIZARD_BASE}/project/query/${clippingJobId}`, {
      headers: { VIZARDAI_API_KEY: this.apiKey() },
    });
    if (!res.ok) {
      this.log.warn(`[vizard] poll ${clippingJobId} HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json().catch(() => ({}))) as VizardResult;
    return this.parseWebhook({ ...json, projectId: clippingJobId });
  }

  private mapClips(jobId: string, videos: VizardVideo[]): ProviderClip[] {
    return videos.map((v, i) => ({
      provider_clip_id: String(v.videoId ?? `${jobId}-${i}`),
      title: v.title ?? v.relatedTopic,
      file_url: v.videoUrl,
      duration_seconds:
        typeof v.videoMsDuration === 'number' ? Math.round(v.videoMsDuration / 1000) : undefined,
      // Vizard entrega 9:16 (1080×1920).
      width: 1080,
      height: 1920,
      transcript: v.transcript,
      hook: v.title,
      extra: {
        viral_score: v.viralScore,
        viral_reason: v.viralReason,
        related_topic: v.relatedTopic,
        clip_editor_url: v.clipEditorUrl,
      },
    }));
  }
}
