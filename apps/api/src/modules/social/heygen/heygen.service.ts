import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { HeyGenProvider, HEYGEN_SCENE_CHAR_LIMIT } from './heygen.provider';
import type {
  CreateHeyGenJobDto,
  HeyGenJob,
  HeyGenJobStatus,
  HeyGenOptions,
} from './heygen.types';

/** Mapeia o status cru do HeyGen pro nosso enum. */
function mapStatus(raw: string): HeyGenJobStatus {
  const s = (raw || '').toLowerCase();
  if (s === 'completed' || s === 'success' || s === 'done') return 'completed';
  if (s === 'failed' || s === 'error') return 'failed';
  if (s === 'pending' || s === 'waiting' || s === 'queued') return 'pending';
  return 'processing';
}

/**
 * HeyGen — orquestra a geração de vídeo com avatar a partir do roteiro de uma
 * pauta (trend_briefs.script) ou de um roteiro cru. Persiste cada disparo em
 * active.heygen_jobs e expõe o ciclo create → poll → URL. Best-effort: sem
 * HEYGEN_API_KEY, options() devolve configured=false e create() recusa com erro
 * acionável (não dispara custo nenhum).
 */
@Injectable()
export class HeyGenService {
  private readonly log = new Logger(HeyGenService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly provider: HeyGenProvider,
  ) {}

  isConfigured(): boolean {
    return this.provider.isConfigured();
  }

  /** Catálogo de avatares + vozes pro modal. Sem key → listas vazias. */
  async options(): Promise<HeyGenOptions> {
    if (!this.provider.isConfigured()) {
      return { configured: false, avatars: [], voices: [] };
    }
    const [avatars, voices] = await Promise.all([
      this.provider.listAvatars().catch((e) => {
        this.log.warn(`listAvatars falhou: ${(e as Error).message}`);
        return [];
      }),
      this.provider.listVoices().catch((e) => {
        this.log.warn(`listVoices falhou: ${(e as Error).message}`);
        return [];
      }),
    ]);
    return { configured: true, avatars, voices };
  }

  async listJobs(orgId: string, limit = 40): Promise<HeyGenJob[]> {
    const { data } = await this.supabase.adminClient
      .from('heygen_jobs')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as HeyGenJob[];
  }

  /** Lê 1 job; se ainda em andamento, atualiza do HeyGen antes de devolver. */
  async getJob(orgId: string, id: string): Promise<HeyGenJob> {
    const { data } = await this.supabase.adminClient
      .from('heygen_jobs')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    const job = data as HeyGenJob | null;
    if (!job) throw new NotFoundException('Job HeyGen não encontrado.');
    if ((job.status === 'pending' || job.status === 'processing') && job.heygen_video_id) {
      return (await this.refresh(job)) ?? job;
    }
    return job;
  }

  /** Dispara a geração: resolve o roteiro, limpa a narração, cria o vídeo. */
  async createJob(orgId: string, dto: CreateHeyGenJobDto): Promise<HeyGenJob> {
    if (!this.provider.isConfigured()) {
      throw new BadRequestException(
        'HeyGen não configurado: defina HEYGEN_API_KEY na active-api pra gerar vídeos com avatar.',
      );
    }
    if (!dto.avatar_id || !dto.voice_id) {
      throw new BadRequestException('Escolha um avatar e uma voz do HeyGen.');
    }

    // Roteiro-fonte: pauta ou texto cru.
    let rawScript = dto.script ?? '';
    let title = dto.title ?? null;
    let format = '';
    let targetSeconds: number | null = null;
    if (dto.brief_id) {
      const { data } = await this.supabase.adminClient
        .from('trend_briefs')
        .select('script, title, format, target_seconds')
        .eq('org_id', orgId)
        .eq('id', dto.brief_id)
        .maybeSingle();
      const brief = data as
        | { script: string | null; title: string | null; format: string | null; target_seconds: number | null }
        | null;
      if (!brief) throw new NotFoundException('Pauta não encontrada.');
      rawScript = brief.script ?? '';
      title = title ?? brief.title;
      format = brief.format ?? '';
      targetSeconds = brief.target_seconds;
    }

    const narration = extractNarration(rawScript);
    if (!narration.trim()) {
      throw new BadRequestException(
        'O roteiro está vazio ou sem narração aproveitável pra gerar o vídeo.',
      );
    }
    const scenes = chunkScript(narration);

    // Dimensão: vertical p/ Short, 16:9 p/ vídeo longo; override por dto.
    const vertical =
      format === 'youtube_short' || (targetSeconds != null && targetSeconds > 0 && targetSeconds < 90);
    const dimension = {
      width: dto.width ?? (vertical ? 720 : 1280),
      height: dto.height ?? (vertical ? 1280 : 720),
    };

    let videoId: string;
    try {
      videoId = await this.provider.createVideo(scenes, dto.avatar_id, dto.voice_id, dimension);
    } catch (e) {
      throw new BadRequestException(`HeyGen recusou a geração: ${(e as Error).message}`);
    }

    const { data, error } = await this.supabase.adminClient
      .from('heygen_jobs')
      .insert({
        org_id: orgId,
        brief_id: dto.brief_id ?? null,
        avatar_id: dto.avatar_id,
        voice_id: dto.voice_id,
        title: (title ?? '').slice(0, 200) || null,
        script: narration.slice(0, 20000),
        dimension,
        heygen_video_id: videoId,
        status: 'processing',
      })
      .select('*')
      .single();
    if (error) {
      this.log.warn(`heygen_jobs insert falhou: ${error.message}`);
      throw new BadRequestException('Vídeo criado no HeyGen, mas falhou ao salvar o job.');
    }
    this.log.log(`job criado org=${orgId} video=${videoId} cenas=${scenes.length}`);
    return data as HeyGenJob;
  }

  /** Atualiza 1 job consultando o status no HeyGen. Retorna a row atualizada. */
  private async refresh(job: HeyGenJob): Promise<HeyGenJob | null> {
    if (!job.heygen_video_id) return null;
    let st;
    try {
      st = await this.provider.getStatus(job.heygen_video_id);
    } catch (e) {
      this.log.warn(`getStatus job=${job.id} falhou: ${(e as Error).message}`);
      return null;
    }
    const status = mapStatus(st.status);
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === 'completed') {
      patch.video_url = st.video_url;
      patch.thumbnail_url = st.thumbnail_url;
      patch.duration_sec = st.duration_sec;
    }
    if (status === 'failed') {
      patch.error = (st.error ?? 'Falha na geração do HeyGen').slice(0, 500);
    }
    const { data } = await this.supabase.adminClient
      .from('heygen_jobs')
      .update(patch)
      .eq('id', job.id)
      .select('*')
      .single();
    return (data as HeyGenJob) ?? { ...job, ...patch } as HeyGenJob;
  }

  /**
   * Polling em lote (worker): atualiza os jobs em andamento de TODAS as orgs.
   * Best-effort — sem key, no-op. Retorna quantos foram concluídos no tick.
   */
  async pollOpenJobs(): Promise<{ checked: number; completed: number }> {
    if (!this.provider.isConfigured()) return { checked: 0, completed: 0 };
    const { data } = await this.supabase.adminClient
      .from('heygen_jobs')
      .select('*')
      .in('status', ['pending', 'processing'])
      .not('heygen_video_id', 'is', null)
      .order('created_at', { ascending: true })
      .limit(50);
    const jobs = (data ?? []) as HeyGenJob[];
    let completed = 0;
    for (const job of jobs) {
      const updated = await this.refresh(job);
      if (updated?.status === 'completed') completed++;
    }
    return { checked: jobs.length, completed };
  }
}

/**
 * Extrai só a NARRAÇÃO falável do roteiro: remove cabeçalhos de timestamp
 * ([00:00 — …]), rubricas de cena entre parênteses ((Cena: …)) e prefixos de
 * locutor (Narrador:, Narração:, VO:). Sobra o texto que o avatar vai falar.
 */
export function extractNarration(script: string): string {
  if (!script) return '';
  const out: string[] = [];
  for (let line of script.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    // linha-cabeçalho do tipo [00:00 — ABERTURA] ou [BLOCO 1]
    if (/^\[[^\]]*\]$/.test(line)) continue;
    // remove [..] e (..) inline (timestamps soltos / rubricas de cena)
    line = line.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
    // se a linha INTEIRA era uma rubrica, já era
    if (!line.trim()) continue;
    // prefixo de locutor → fica só a fala
    line = line.replace(/^\s*(narrador|narra[çc][ãa]o|locutor|voz|vo|apresentador)\s*[:\-–]\s*/i, '');
    // aspas/markdown ao redor da fala
    line = line.replace(/^["'“”*]+|["'“”*]+$/g, '').trim();
    if (line) out.push(line);
  }
  return out.join('\n').trim();
}

/** Quebra a narração em cenas <= limite do HeyGen, sem cortar frase no meio. */
export function chunkScript(text: string, limit = HEYGEN_SCENE_CHAR_LIMIT): string[] {
  const clean = text.trim();
  if (clean.length <= limit) return [clean];
  const chunks: string[] = [];
  // unidades: parágrafos; se um parágrafo for grande, quebra por frase.
  const units = clean.split(/\n+/).flatMap((p) =>
    p.length <= limit ? [p] : p.match(/[^.!?]+[.!?]*\s*/g) ?? [p],
  );
  let cur = '';
  for (const u of units) {
    const piece = u.trim();
    if (!piece) continue;
    if ((cur + ' ' + piece).trim().length > limit && cur) {
      chunks.push(cur.trim());
      cur = piece;
    } else {
      cur = cur ? `${cur} ${piece}` : piece;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  // hard-split de segurança caso uma frase única estoure o limite
  return chunks.flatMap((c) =>
    c.length <= limit ? [c] : (c.match(new RegExp(`.{1,${limit}}`, 'g')) ?? [c]),
  );
}
