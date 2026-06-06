import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { LlmService } from '../../../common/llm/llm.service';
import { YouTubeThumbnailService } from './youtube-thumbnail.service';
import { YouTubeShortsProvider } from './youtube-shorts.provider';
import { CortesYouTubeService } from './cortes-youtube.service';
import type { HeyGenJob } from '../../social/heygen/heygen.types';
import type {
  GenerateDraftDto,
  UpdateDraftDto,
  YouTubeChapter,
  YouTubePublication,
} from './youtube-longform.types';

interface BrandColors {
  primary: string;
  secondary: string;
  name: string | null;
}

interface LlmMeta {
  title: string;
  description_body: string;
  tags: string[];
  chapters: YouTubeChapter[];
  thumbnail_title: string;
  thumbnail_bg_prompt: string;
}

const META_SYSTEM = `Você é especialista em SEO e crescimento de canais no YouTube (mercado brasileiro).
Recebe o roteiro de um vídeo e devolve metadados OTIMIZADOS para descoberta e CTR.
Regras:
- Tudo em português do Brasil, linguagem natural (NÃO robótica).
- Título: até 95 caracteres, forte, específico, com a palavra-chave principal no começo, desperta curiosidade sem clickbait barato.
- Descrição (description_body): 2 a 4 parágrafos curtos. 1ª linha é um gancho (aparece no topo). Inclui as palavras-chave naturalmente. NÃO inclua capítulos, links nem hashtags aqui (são adicionados depois).
- Tags: 8 a 15, sem '#', minúsculas, mix de termos amplos e long-tail.
- Capítulos (chapters): derivados das seções/timestamps do roteiro. O PRIMEIRO timestamp é SEMPRE "0:00". Rótulos curtos (2-4 palavras). De 4 a 8 capítulos, em ordem crescente, formato mm:ss.
- thumbnail_title: 2 a 5 palavras de MUITO impacto pra estampar na capa (CAIXA ALTA não é obrigatório).
- thumbnail_bg_prompt: descrição em PT do FUNDO da miniatura (cena/clima sobre o tema), SEM pessoas em primeiro plano e SEM texto.
Responda SOMENTE com JSON válido, sem comentários.`;

/**
 * Orquestra a publicação de VÍDEO LONGO no YouTube a partir de um vídeo do
 * HeyGen (Radar): gera metadados por IA (título/descrição/capítulos/tags),
 * monta a miniatura (fundo IA + avatar + título) e publica via o provider
 * (reusando o OAuth/canal do Studio de Cortes). A publicação em si é SEMPRE
 * por ação explícita (botão) — nunca automática.
 */
@Injectable()
export class YouTubeLongformService {
  private readonly log = new Logger(YouTubeLongformService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
    private readonly thumbnail: YouTubeThumbnailService,
    private readonly provider: YouTubeShortsProvider,
    private readonly youtube: CortesYouTubeService,
  ) {}

  // ── Leitura ────────────────────────────────────────────────

  async list(orgId: string): Promise<YouTubePublication[]> {
    const { data } = await this.supabase.adminClient
      .from('social_youtube_publications')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50);
    return (data ?? []) as YouTubePublication[];
  }

  async get(orgId: string, id: string): Promise<YouTubePublication> {
    const { data } = await this.supabase.adminClient
      .from('social_youtube_publications')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (!data) throw new NotFoundException('Publicação não encontrada.');
    return data as YouTubePublication;
  }

  async channels(orgId: string) {
    return this.youtube.listChannels(orgId);
  }

  // ── Geração do rascunho (metadados + miniatura) ────────────

  async generateDraft(orgId: string, dto: GenerateDraftDto): Promise<YouTubePublication> {
    let heygenJob: HeyGenJob | null = null;
    let videoUrl = dto.source_video_url?.trim() || null;
    let baseTitle = dto.title?.trim() || '';
    let script = '';

    if (dto.heygen_job_id) {
      heygenJob = await this.readHeyGenJob(orgId, dto.heygen_job_id);
      if (heygenJob.status !== 'completed' || !heygenJob.video_url) {
        throw new BadRequestException('O vídeo do HeyGen ainda não está concluído.');
      }
      videoUrl = heygenJob.video_url;
      baseTitle = baseTitle || heygenJob.title || 'Vídeo e-Click';
      script = heygenJob.script ?? '';
    }
    if (!videoUrl) {
      throw new BadRequestException('Informe heygen_job_id (vídeo concluído) ou source_video_url.');
    }

    // Idempotência: se já existe publicação pro mesmo vídeo HeyGen, não recria —
    // só regenera os metadados se for rascunho e o usuário pediu (regenerate),
    // e nunca mexe numa que já está publicando/publicada.
    let existing: YouTubePublication | null = null;
    if (dto.heygen_job_id) {
      const { data } = await this.supabase.adminClient
        .from('social_youtube_publications')
        .select('*')
        .eq('org_id', orgId)
        .eq('heygen_job_id', dto.heygen_job_id)
        .maybeSingle();
      existing = (data as YouTubePublication | null) ?? null;
      if (existing) {
        if (existing.status === 'publishing' || existing.status === 'published') return existing;
        if (!dto.regenerate) return existing; // rascunho já existe — devolve pra editar
      }
    }

    const brand = await this.brandColors(orgId);
    const meta = await this.generateMetadata(orgId, baseTitle, script);
    const description = this.assembleDescription(meta);

    // Miniatura (best-effort: se falhar, segue sem capa — set depois).
    let thumbUrl: string | null = null;
    let thumbPath: string | null = null;
    try {
      const built = await this.thumbnail.build(orgId, {
        title: meta.thumbnail_title || meta.title,
        bgPrompt: meta.thumbnail_bg_prompt || `Tema: ${meta.title}`,
        avatarImageUrl: heygenJob?.thumbnail_url ?? null,
        primaryColor: brand.primary,
        secondaryColor: brand.secondary,
      });
      thumbUrl = built.url;
      thumbPath = built.storage_path;
    } catch (err) {
      this.log.warn(`[ytlf] miniatura falhou (org=${orgId}): ${String(err)}`);
    }

    const row = {
      org_id: orgId,
      heygen_job_id: dto.heygen_job_id ?? null,
      source_video_url: videoUrl,
      title: meta.title.slice(0, 100),
      description: description.slice(0, 4900),
      tags: meta.tags.slice(0, 15),
      category_id: process.env.YOUTUBE_LONGFORM_CATEGORY ?? '27',
      privacy: 'public' as const,
      chapters: meta.chapters,
      thumbnail_url: thumbUrl,
      thumbnail_storage_path: thumbPath,
      status: 'draft' as const,
      error: null,
    };

    if (existing) {
      const { data, error } = await this.supabase.adminClient
        .from('social_youtube_publications')
        .update(row as never)
        .eq('id', existing.id)
        .eq('org_id', orgId)
        .select('*')
        .single();
      if (error) throw error;
      return data as YouTubePublication;
    }

    const { data, error } = await this.supabase.adminClient
      .from('social_youtube_publications')
      .insert(row as never)
      .select('*')
      .single();
    if (error) throw error;
    return data as YouTubePublication;
  }

  // ── Edição ─────────────────────────────────────────────────

  async updateDraft(orgId: string, id: string, dto: UpdateDraftDto): Promise<YouTubePublication> {
    const pub = await this.get(orgId, id);
    if (pub.status === 'publishing' || pub.status === 'published') {
      throw new BadRequestException('Não dá pra editar uma publicação já enviada.');
    }
    const patch: Record<string, unknown> = {};
    if (dto.title !== undefined) patch.title = dto.title.slice(0, 100);
    if (dto.description !== undefined) patch.description = dto.description.slice(0, 4900);
    if (dto.tags !== undefined) patch.tags = dto.tags.slice(0, 15);
    if (dto.category_id !== undefined) patch.category_id = dto.category_id;
    if (dto.privacy !== undefined) patch.privacy = dto.privacy;
    if (dto.chapters !== undefined) patch.chapters = dto.chapters;
    if (dto.channel_cred_id !== undefined) patch.channel_cred_id = dto.channel_cred_id;
    if (Object.keys(patch).length === 0) return pub;

    const { data, error } = await this.supabase.adminClient
      .from('social_youtube_publications')
      .update(patch as never)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as YouTubePublication;
  }

  async regenerateThumbnail(orgId: string, id: string): Promise<YouTubePublication> {
    const pub = await this.get(orgId, id);
    const brand = await this.brandColors(orgId);
    let heygenThumb: string | null = null;
    if (pub.heygen_job_id) {
      const job = await this.readHeyGenJob(orgId, pub.heygen_job_id).catch(() => null);
      heygenThumb = job?.thumbnail_url ?? null;
    }
    const built = await this.thumbnail.build(orgId, {
      title: pub.title,
      bgPrompt: `Tema do vídeo: ${pub.title}`,
      avatarImageUrl: heygenThumb,
      primaryColor: brand.primary,
      secondaryColor: brand.secondary,
    });
    const { data, error } = await this.supabase.adminClient
      .from('social_youtube_publications')
      .update({ thumbnail_url: built.url, thumbnail_storage_path: built.storage_path } as never)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as YouTubePublication;
  }

  // ── Publicação (ação explícita) ────────────────────────────

  async publish(orgId: string, id: string, channelCredId?: string | null): Promise<YouTubePublication> {
    const pub = await this.get(orgId, id);
    if (pub.status === 'published') {
      throw new BadRequestException('Este vídeo já foi publicado.');
    }
    const credId = channelCredId ?? pub.channel_cred_id ?? null;

    await this.setStatus(orgId, id, 'publishing', { channel_cred_id: credId });

    const result = await this.provider.publish(
      orgId,
      {
        video_url: pub.source_video_url,
        title: pub.title,
        description: pub.description,
        tags: pub.tags,
        privacy: pub.privacy,
        is_short: false,
        category_id: pub.category_id,
        thumbnail_url: pub.thumbnail_url ?? undefined,
      },
      credId,
    );

    if (result.success && result.external_post_id) {
      const { data } = await this.supabase.adminClient
        .from('social_youtube_publications')
        .update({
          status: 'published',
          youtube_video_id: result.external_post_id,
          youtube_url: result.external_post_url ?? null,
          published_at: new Date().toISOString(),
          error: null,
        } as never)
        .eq('id', id)
        .eq('org_id', orgId)
        .select('*')
        .single();
      this.log.log(`[ytlf] publicado: ${result.external_post_url} (pub ${id})`);
      return data as YouTubePublication;
    }

    const { data } = await this.supabase.adminClient
      .from('social_youtube_publications')
      .update({
        status: 'failed',
        error: (result.error_message ?? 'falha na publicação').slice(0, 500),
      } as never)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    this.log.warn(`[ytlf] publicação falhou (pub ${id}): ${result.error_message}`);
    return data as YouTubePublication;
  }

  // ── Helpers ────────────────────────────────────────────────

  private async setStatus(
    orgId: string,
    id: string,
    status: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.supabase.adminClient
      .from('social_youtube_publications')
      .update({ status, ...extra } as never)
      .eq('id', id)
      .eq('org_id', orgId);
  }

  private async readHeyGenJob(orgId: string, jobId: string): Promise<HeyGenJob> {
    const { data } = await this.supabase.adminClient
      .from('heygen_jobs')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', jobId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Vídeo HeyGen não encontrado.');
    return data as HeyGenJob;
  }

  private async brandColors(orgId: string): Promise<BrandColors> {
    const { data } = await this.supabase.adminClient
      .from('social_brands')
      .select('primary_color, secondary_color, name')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const b = data as { primary_color?: string; secondary_color?: string; name?: string } | null;
    return {
      primary: b?.primary_color || '#00E5FF',
      secondary: b?.secondary_color || '#0a0a0e',
      name: b?.name ?? null,
    };
  }

  private async generateMetadata(orgId: string, baseTitle: string, script: string): Promise<LlmMeta> {
    const cleanScript = stripScript(script).slice(0, 6000);
    const user = [
      `Título-base/tema da pauta: ${baseTitle || '(sem título)'}`,
      '',
      'ROTEIRO:',
      cleanScript || '(roteiro indisponível — gere a partir do título-base)',
      '',
      'Responda com JSON neste formato exato:',
      '{"title":"...","description_body":"...","tags":["..."],"chapters":[{"t":"0:00","label":"..."}],"thumbnail_title":"...","thumbnail_bg_prompt":"..."}',
    ].join('\n');

    try {
      const r = await this.llm.chat({
        orgId,
        feature: 'youtube_longform_metadata',
        system: META_SYSTEM,
        user,
        json_mode: true,
        max_tokens: 1500,
        temperature: 0.6,
      });
      const clean = r.text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(clean) as Partial<LlmMeta>;
      return this.normalizeMeta(parsed, baseTitle);
    } catch (err) {
      this.log.warn(`[ytlf] geração de metadados falhou (org=${orgId}): ${String(err)} — usando fallback`);
      return this.fallbackMeta(baseTitle);
    }
  }

  private normalizeMeta(parsed: Partial<LlmMeta>, baseTitle: string): LlmMeta {
    let chapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
    chapters = chapters
      .filter((c) => c && typeof c.t === 'string' && typeof c.label === 'string')
      .map((c) => ({ t: c.t.trim(), label: c.label.trim() }));
    // O YouTube exige que o 1º capítulo seja 0:00.
    if (chapters.length && chapters[0].t !== '0:00' && chapters[0].t !== '00:00') {
      chapters.unshift({ t: '0:00', label: 'Introdução' });
    }
    chapters = chapters.slice(0, 8);
    return {
      title: (parsed.title || baseTitle || 'Vídeo e-Click').toString().slice(0, 100),
      description_body: (parsed.description_body || '').toString(),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean).slice(0, 15)
        : [],
      chapters,
      thumbnail_title: (parsed.thumbnail_title || baseTitle || '').toString().slice(0, 60),
      thumbnail_bg_prompt: (parsed.thumbnail_bg_prompt || `Tema: ${baseTitle}`).toString(),
    };
  }

  private fallbackMeta(baseTitle: string): LlmMeta {
    const title = baseTitle || 'Vídeo e-Click';
    return {
      title: title.slice(0, 100),
      description_body: `${title}\n\nConteúdo produzido pela e-Click.`,
      tags: [],
      chapters: [],
      thumbnail_title: title.slice(0, 40),
      thumbnail_bg_prompt: `Tema: ${title}`,
    };
  }

  /** Monta a descrição final: corpo + capítulos + links + hashtags. */
  private assembleDescription(meta: LlmMeta): string {
    const parts: string[] = [meta.description_body.trim()];

    if (meta.chapters.length >= 2) {
      const lines = meta.chapters.map((c) => `${c.t} ${c.label}`).join('\n');
      parts.push(`⏱️ CAPÍTULOS\n${lines}`);
    }

    const links = (process.env.YOUTUBE_LONGFORM_LINKS ?? '🌐 e-Click: https://eclick.app.br').trim();
    if (links) parts.push(`🔗 LINKS\n${links}`);

    if (meta.tags.length) {
      const tags = meta.tags
        .slice(0, 6)
        .map((t) => `#${t.replace(/\s+/g, '')}`)
        .join(' ');
      parts.push(tags);
    }

    return parts.filter(Boolean).join('\n\n');
  }
}

/** Remove timestamps/rubricas do roteiro pra o LLM ler o conteúdo limpo. */
function stripScript(script: string): string {
  return (script ?? '')
    .replace(/^\s*(narrador|locução|locutor)\s*:/gim, '')
    .trim();
}
