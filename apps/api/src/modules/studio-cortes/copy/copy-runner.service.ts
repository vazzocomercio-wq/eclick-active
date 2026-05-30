import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { LlmService } from '../../../common/llm/llm.service';
import type { Clip, ContentJob } from '../studio-cortes.types';

interface PlatformCopy {
  caption?: string;
  description?: string;
  title?: string;
  hashtags?: string[];
}

interface GeneratedCopy {
  hook?: string;
  instagram?: PlatformCopy;
  tiktok?: PlatformCopy;
  youtube?: PlatformCopy;
}

const SYSTEM_PROMPT = `Você é o estrategista de conteúdo do e-Click. Escreve copys curtas, com autoridade e tom consultivo (nada de clickbait barato). A partir da transcrição de um corte de vídeo vertical, gera as legendas de cada plataforma.

Responda SOMENTE com JSON válido neste formato:
{
  "hook": "gancho de 1 linha pra abertura do vídeo",
  "instagram": { "caption": "legenda Instagram (2-4 linhas, com quebras)", "hashtags": ["sem #"] },
  "tiktok": { "caption": "legenda TikTok curta e direta", "hashtags": ["sem #"] },
  "youtube": { "title": "título YouTube Shorts (<=90 chars)", "description": "descrição curta", "hashtags": ["sem #"] }
}

Regras: PT-BR. 3-6 hashtags por plataforma, relevantes ao tema (sem #). Sem emojis em excesso. Não invente dados que não estão na transcrição.`;

/**
 * CopyRunner — gera as copys por plataforma de cada corte (via LlmService /
 * Sonnet), grava em clip_posts (status rascunho) e leva o job a 'in_review'.
 */
@Injectable()
export class CopyRunnerService {
  private readonly log = new Logger(CopyRunnerService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
  ) {}

  /** Gera copys de todos os cortes do job e move o job pra revisão. */
  async runForJob(orgId: string, jobId: string): Promise<{ generated: number }> {
    const { data: jobData } = await this.supabase.adminClient
      .from('content_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle();
    const job = jobData as ContentJob | null;
    if (!job) return { generated: 0 };

    const { data: clipsData } = await this.supabase.adminClient
      .from('clips')
      .select('*')
      .eq('job_id', jobId)
      .eq('org_id', orgId)
      .order('order_index', { ascending: true });
    const clips = (clipsData ?? []) as Clip[];

    let generated = 0;
    for (const clip of clips) {
      try {
        await this.generateForClip(orgId, clip);
        generated += 1;
      } catch (err) {
        this.log.warn(`[copy] clip ${clip.id} falhou: ${String(err)}`);
      }
    }

    // auto-aprovar por job (default OFF) — só muda estado dos cortes.
    if (job.auto_approve) {
      await this.supabase.adminClient
        .from('clips')
        .update({ status: 'aprovado' })
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .eq('status', 'a_revisar');
    }

    await this.supabase.adminClient
      .from('content_jobs')
      .update({ status: 'in_review' })
      .eq('id', jobId)
      .eq('org_id', orgId);

    this.log.log(`[copy] job ${jobId} → ${generated} cortes com copy, em revisão`);
    return { generated };
  }

  /** Gera as copys de UM corte e faz upsert dos clip_posts (3 plataformas). */
  async generateForClip(orgId: string, clip: Clip): Promise<void> {
    const transcript = (clip.transcript ?? '').trim();
    const userPrompt = [
      clip.title ? `Tópico do corte: ${clip.title}` : '',
      clip.hook ? `Gancho detectado: ${clip.hook}` : '',
      transcript
        ? `Transcrição do corte:\n${transcript.slice(0, 6000)}`
        : 'Sem transcrição — gere copys genéricas a partir do tópico/gancho.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const result = await this.llm.chat({
      orgId,
      feature: 'studio_cortes_copy',
      system: SYSTEM_PROMPT,
      user: userPrompt,
      json_mode: true,
      max_tokens: 1200,
      temperature: 0.7,
    });

    const copy = this.safeParse(result.text);

    const posts = [
      {
        platform: 'instagram' as const,
        title: null as string | null,
        copy: copy.instagram?.caption ?? null,
        hashtags: copy.instagram?.hashtags ?? [],
      },
      {
        platform: 'tiktok' as const,
        title: null as string | null,
        copy: copy.tiktok?.caption ?? null,
        hashtags: copy.tiktok?.hashtags ?? [],
      },
      {
        platform: 'youtube' as const,
        title: copy.youtube?.title ?? clip.title ?? null,
        copy: copy.youtube?.description ?? null,
        hashtags: copy.youtube?.hashtags ?? [],
      },
    ].map((p) => ({
      clip_id: clip.id,
      org_id: orgId,
      platform: p.platform,
      title: p.title,
      copy: p.copy,
      hashtags: p.hashtags,
      status: 'rascunho' as const,
    }));

    const { error } = await this.supabase.adminClient
      .from('clip_posts')
      .upsert(posts, { onConflict: 'clip_id,platform' });
    if (error) throw new Error(error.message);

    // Grava o hook gerado de volta no corte se ainda não tinha.
    if (copy.hook && !clip.hook) {
      await this.supabase.adminClient
        .from('clips')
        .update({ hook: copy.hook })
        .eq('id', clip.id)
        .eq('org_id', orgId);
    }
  }

  private safeParse(text: string): GeneratedCopy {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
    try {
      return JSON.parse(cleaned) as GeneratedCopy;
    } catch {
      // tenta extrair o primeiro bloco {...}
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]) as GeneratedCopy;
        } catch {
          /* cai pro vazio */
        }
      }
      this.log.warn('[copy] resposta da IA não era JSON — gravando copys vazias');
      return {};
    }
  }
}
