import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { LlmService } from '../../../common/llm/llm.service';
import { SocialBrandsService } from '../social-brands.service';
import { SocialCalendarsService } from '../social-calendars.service';
import { ImageGenerationService } from '../image-generation/image-generation.service';
import { BridgeService } from '../../bridge/bridge.service';
import { SocialPromptsService } from '../prompts/social-prompts.service';
import {
  CALENDAR_SYSTEM_PROMPT,
  POST_SYSTEM_PROMPT,
  CAROUSEL_SYSTEM_PROMPT,
  REEL_SCRIPT_SYSTEM_PROMPT,
  buildBrandContextBlock,
} from './prompts';
import type {
  CalendarItemDraft,
  SocialContent,
  SocialContentSlide,
  ContentPillar,
} from '../social.types';
import type { GenerateCalendarDto } from '../dto/calendar.dto';
import type {
  GeneratePostDto,
  GenerateCarouselDto,
  GenerateReelDto,
  RegenerateContentDto,
} from '../dto/content.dto';

interface GeneratedReel {
  caption: string;
  hashtags: string[];
  video_prompt: string;
  scene_prompt?: string;
  alt_text?: string;
}

interface GeneratedPost {
  caption: string;
  hashtags: string[];
  image_prompt: string;
  alt_text?: string;
}

interface GeneratedCarousel {
  caption: string;
  hashtags: string[];
  slides: SocialContentSlide[];
}

/**
 * Coração do módulo: orquestra geração de calendários, posts e
 * carrosséis via Claude (LlmService) + ImageGenerationService.
 *
 * Pipeline padrão de post:
 *   1. Buscar BrandContext via SocialBrandsService
 *   2. Claude gera copy + image_prompt
 *   3. ImageGenerationService gera + faz upload
 *   4. Persistir no social_contents com status='pending_approval'
 *   5. Emitir Supabase Realtime (já habilitado na M054)
 */
@Injectable()
export class SocialAiGeneratorService {
  private readonly log = new Logger(SocialAiGeneratorService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
    private readonly brands: SocialBrandsService,
    private readonly calendars: SocialCalendarsService,
    private readonly images: ImageGenerationService,
    private readonly bridge: BridgeService,
    private readonly prompts: SocialPromptsService,
  ) {}

  // ─── Calendário ──────────────────────────────────

  async generateCalendar(
    orgId: string,
    dto: GenerateCalendarDto,
  ): Promise<{
    calendar_id: string;
    items_created: number;
    items: CalendarItemDraft[];
  }> {
    const t0 = Date.now();
    const ctx = await this.brands.getContext(orgId, dto.brand_id);
    const ctxBlock = buildBrandContextBlock(ctx);

    const userPrompt = [
      ctxBlock,
      '',
      `OBJETIVO: ${dto.objective}`,
      `CANAIS: ${dto.channels.join(', ')}`,
      `PERÍODO: ${dto.duration_days} dias começando em ${dto.start_date}`,
      `FREQUÊNCIA: ${dto.frequency_per_week} posts/semana`,
      `MIX: ${JSON.stringify(dto.content_mix ?? {})}`,
      dto.special_dates?.length
        ? `DATAS ESPECIAIS: ${dto.special_dates.map((d) => `${d.date}=${d.theme}`).join('; ')}`
        : '',
      dto.campaigns?.length
        ? `CAMPANHAS: ${dto.campaigns.map((c) => `${c.name} ${c.start}→${c.end}`).join('; ')}`
        : '',
      '',
      `Crie até ${Math.min(30, Math.ceil((dto.duration_days * dto.frequency_per_week) / 7))} itens.`,
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.llm.chat({
      orgId,
      feature: 'social_calendar',
      system: await this.prompts.getSystemPrompt(orgId, 'CALENDAR_SYSTEM_PROMPT', CALENDAR_SYSTEM_PROMPT),
      user: userPrompt,
      json_mode: true,
      max_tokens: 4000,
      temperature: 0.6,
    });

    const parsed = this.parseJson<{
      calendar_name?: string;
      items?: CalendarItemDraft[];
    }>(result.text);

    const calendarName =
      parsed?.calendar_name ?? `Calendário ${dto.start_date}`;
    const items = (parsed?.items ?? []).filter(this.isValidItem);

    const endDate = this.addDays(dto.start_date, dto.duration_days);

    const calendar = await this.calendars.create(orgId, {
      brand_id: dto.brand_id,
      name: calendarName,
      start_date: dto.start_date,
      end_date: endDate,
      channels: dto.channels,
      objective: dto.objective,
      frequency_per_week: dto.frequency_per_week,
      content_mix: dto.content_mix,
    });

    // Cria social_contents draft pra cada item
    let created = 0;
    for (const item of items) {
      try {
        await this.supabase.adminClient.from('social_contents').insert({
          org_id: orgId,
          brand_id: dto.brand_id,
          calendar_id: calendar.id,
          content_type: item.content_type,
          pillar: item.pillar,
          title: item.theme,
          channels: [item.channel],
          scheduled_for: this.combineDateAndTime(item.date, item.time),
          status: 'draft',
          ai_prompt: item.brief,
          metadata: {
            hook: item.hook,
            brief: item.brief,
            cta_suggested: item.cta,
            hashtags_suggested: item.hashtags_suggested,
            needs_image: item.needs_image,
          },
        });
        created += 1;
      } catch (err) {
        this.log.warn(`insert calendar item falhou: ${String(err)}`);
      }
    }

    this.log.log(
      `Calendário gerado em ${Date.now() - t0}ms: ${created}/${items.length} itens`,
    );
    return { calendar_id: calendar.id, items_created: created, items };
  }

  // ─── Post estático ───────────────────────────────

  async generatePost(orgId: string, contentId: string): Promise<SocialContent> {
    const t0 = Date.now();
    await this.markGenerating(contentId);

    const content = await this.fetchContent(orgId, contentId);
    const ctx = await this.brands.getContext(orgId, content.brand_id);
    const ctxBlock = buildBrandContextBlock(ctx);

    const meta = content.metadata as {
      hook?: string;
      brief?: string;
      cta_suggested?: string;
      visual_style?: string;
    };

    const userPrompt = [
      ctxBlock,
      '',
      `BRIEF: ${meta.brief ?? content.title ?? ''}`,
      meta.hook ? `HOOK SUGERIDO: ${meta.hook}` : '',
      meta.cta_suggested
        ? `CTA SUGERIDO: ${meta.cta_suggested}`
        : ctx.business.main_cta
          ? `CTA: ${ctx.business.main_cta}`
          : '',
      content.pillar ? `PILAR: ${content.pillar}` : '',
      meta.visual_style ? `ESTILO VISUAL: ${meta.visual_style}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.llm.chat({
      orgId,
      feature: 'social_post',
      system: await this.prompts.getSystemPrompt(orgId, 'POST_SYSTEM_PROMPT', POST_SYSTEM_PROMPT),
      user: userPrompt,
      json_mode: true,
      max_tokens: 1500,
      temperature: 0.7,
    });

    const parsed = this.parseJson<GeneratedPost>(result.text);
    if (!parsed?.caption || !parsed?.image_prompt) {
      await this.markFailed(contentId, 'IA retornou JSON inválido');
      throw new Error('Geração de post falhou — JSON inválido');
    }

    // Gera imagem
    const img = await this.images.generateAndUpload(
      orgId,
      {
        prompt: parsed.image_prompt,
        overlayText: meta.hook ?? content.title ?? '',
        primaryColor: ctx.identity.primary_color,
        secondaryColor: ctx.identity.secondary_color,
        width: 1080,
        height: 1080,
      },
      `posts/${contentId}`,
    );

    // Persiste asset
    await this.supabase.adminClient.from('social_assets').insert({
      org_id: orgId,
      brand_id: content.brand_id,
      name: `Post: ${content.title ?? content.id}`,
      asset_type: 'image',
      url: img.url,
      source: img.provider === 'placeholder' ? 'placeholder' : 'generated_ai',
      ai_provider: img.provider,
      width: img.width,
      height: img.height,
      used_in_contents: [contentId],
      metadata: { content_id: contentId, image_prompt: parsed.image_prompt },
    });

    const updated = await this.updateContentAfterGeneration(orgId, contentId, {
      caption: parsed.caption,
      hashtags: parsed.hashtags ?? [],
      cover_image_url: img.url,
      media: [
        {
          url: img.url,
          width: img.width,
          height: img.height,
          alt_text: parsed.alt_text,
          source:
            img.provider === 'placeholder' ? 'placeholder' : 'generated_ai',
        },
      ],
      ai_model: 'claude+image',
      ai_prompt: parsed.image_prompt,
      ai_generation_time_ms: Date.now() - t0,
      status: 'pending_approval',
    });

    return updated;
  }

  // ─── Carrossel ───────────────────────────────────

  async generateCarousel(
    orgId: string,
    contentId: string,
  ): Promise<SocialContent> {
    const t0 = Date.now();
    await this.markGenerating(contentId);

    const content = await this.fetchContent(orgId, contentId);
    const ctx = await this.brands.getContext(orgId, content.brand_id);
    const ctxBlock = buildBrandContextBlock(ctx);

    const meta = content.metadata as {
      hook?: string;
      brief?: string;
      cta_suggested?: string;
      slide_count?: number;
      structure?: string;
    };

    const slideCount = meta.slide_count ?? 7;
    const userPrompt = [
      ctxBlock,
      '',
      `BRIEF: ${meta.brief ?? content.title ?? ''}`,
      meta.hook ? `HOOK: ${meta.hook}` : '',
      `SLIDES: ${slideCount}`,
      meta.structure ? `ESTRUTURA: ${meta.structure}` : '',
      content.pillar ? `PILAR: ${content.pillar}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.llm.chat({
      orgId,
      feature: 'social_carousel',
      system: await this.prompts.getSystemPrompt(orgId, 'CAROUSEL_SYSTEM_PROMPT', CAROUSEL_SYSTEM_PROMPT),
      user: userPrompt,
      json_mode: true,
      max_tokens: 3500,
      temperature: 0.7,
    });

    const parsed = this.parseJson<GeneratedCarousel>(result.text);
    if (!parsed?.slides?.length) {
      await this.markFailed(contentId, 'IA retornou carrossel vazio');
      throw new Error('Geração de carrossel falhou');
    }

    // Gera imagem pra cada slide (sequencial pra evitar rate limit)
    const enrichedSlides: SocialContentSlide[] = [];
    let coverUrl: string | null = null;
    for (const slide of parsed.slides) {
      try {
        const img = await this.images.generateAndUpload(
          orgId,
          {
            prompt: slide.visual_prompt ?? `Slide ${slide.slide_number}`,
            overlayText: slide.title ?? '',
            primaryColor: ctx.identity.primary_color,
            secondaryColor: ctx.identity.secondary_color,
            width: 1080,
            height: 1080,
          },
          `carousels/${contentId}/slide-${slide.slide_number}`,
        );
        enrichedSlides.push({ ...slide, image_url: img.url });
        if (slide.slide_number === 1) coverUrl = img.url;
      } catch (err) {
        this.log.warn(`Slide ${slide.slide_number} falhou: ${String(err)}`);
        enrichedSlides.push({ ...slide, image_url: null });
      }
    }

    const media = enrichedSlides
      .filter((s) => s.image_url)
      .map((s) => ({
        url: s.image_url as string,
        width: 1080,
        height: 1080,
        source: 'generated_ai' as const,
      }));

    const updated = await this.updateContentAfterGeneration(orgId, contentId, {
      caption: parsed.caption,
      hashtags: parsed.hashtags ?? [],
      cover_image_url: coverUrl,
      media,
      slides: enrichedSlides,
      ai_model: 'claude+carousel',
      ai_generation_time_ms: Date.now() - t0,
      status: 'pending_approval',
    });

    return updated;
  }

  // ─── Reel / vídeo curto ──────────────────────────

  /**
   * Cria o conteúdo (content_type='reel'), gera o roteiro+legenda via Claude
   * (estilo + framework escolhidos) e DISPARA o vídeo no motor do SaaS (ponte).
   * NÃO bloqueia esperando o vídeo (é assíncrono, minutos) — devolve o conteúdo
   * com status='generating' e metadata.video_job_id. O front faz poll em
   * `pollReel` até o vídeo ficar pronto.
   */
  async createAndGenerateReel(
    orgId: string,
    dto: GenerateReelDto,
  ): Promise<SocialContent> {
    const t0 = Date.now();
    const { data, error } = await this.supabase.adminClient
      .from('social_contents')
      .insert({
        org_id: orgId,
        brand_id: dto.brand_id,
        calendar_id: dto.calendar_id ?? null,
        content_type: 'reel',
        pillar: dto.pillar ?? 'product',
        title: dto.theme,
        channels: dto.channels ?? ['instagram'],
        related_product_id: dto.catalog_product_id ?? null,
        status: 'generating',
        metadata: {
          brief: dto.theme,
          hook: dto.hook,
          cta_suggested: dto.cta,
          video_mode: dto.video_mode,
          style: dto.style,
          framework: dto.framework,
          product_photo_url: dto.product_photo_url,
        },
      })
      .select('id')
      .single();
    if (error) throw error;
    const contentId = (data as { id: string }).id;

    const ctx = await this.brands.getContext(orgId, dto.brand_id);
    const userPrompt = [
      buildBrandContextBlock(ctx),
      '',
      `PRODUTO: ${dto.product_title ?? dto.theme}`,
      dto.category ? `CATEGORIA: ${dto.category}` : '',
      dto.product_description ? `DESCRIÇÃO DO PRODUTO: ${dto.product_description.slice(0, 800)}` : '',
      `TEMA: ${dto.theme}`,
      dto.video_mode === 'ai_scene'
        ? 'MODO: cena gerada por IA (produto inserido num ambiente)'
        : 'MODO: animar a foto real do produto',
      dto.style_label ? `ESTILO DE VÍDEO: ${dto.style_label}${dto.style_prompt ? ` — ${dto.style_prompt}` : ''}` : '',
      dto.framework_label ? `ESTRUTURA DE ROTEIRO: ${dto.framework_label}${dto.framework_prompt ? ` — ${dto.framework_prompt}` : ''}` : '',
      dto.hook ? `HOOK SUGERIDO: ${dto.hook}` : '',
      dto.cta ? `CTA: ${dto.cta}` : ctx.business.main_cta ? `CTA: ${ctx.business.main_cta}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.llm.chat({
      orgId,
      feature: 'social_reel',
      system: await this.prompts.getSystemPrompt(orgId, 'REEL_SCRIPT_SYSTEM_PROMPT', REEL_SCRIPT_SYSTEM_PROMPT),
      user: userPrompt,
      json_mode: true,
      max_tokens: 1500,
      temperature: 0.7,
    });
    const parsed = this.parseJson<GeneratedReel>(result.text);
    if (!parsed?.video_prompt) {
      await this.markFailed(contentId, 'IA não retornou roteiro de vídeo');
      throw new Error('Geração de reel falhou — JSON inválido');
    }

    // Dispara o vídeo no SaaS (assíncrono). Multi-cena = N fotos → N clipes.
    const multi = !!dto.multi_scene && (dto.photo_urls?.length ?? 0) > 1;
    let singleJobId: string | null = null;
    let jobIds: string[] = [];
    if (multi) {
      const r = await this.bridge.startMultiSceneVideo(orgId, {
        photo_urls: dto.photo_urls!.slice(0, 4),
        prompt: parsed.video_prompt,
        catalog_product_id: dto.catalog_product_id,
        product_title: dto.product_title,
        category: dto.category,
        aspect_ratio: dto.aspect_ratio ?? '9:16',
        duration_seconds: dto.duration_seconds ?? 5,
        model_name: dto.model_name,
        camera_motion: dto.camera_motion,
      });
      jobIds = r?.job_ids ?? [];
    } else {
      const started = await this.bridge.startSocialVideo(orgId, {
        product_photo_url: dto.product_photo_url,
        prompt: parsed.video_prompt,
        mode: dto.video_mode,
        scene_prompt:
          dto.video_mode === 'ai_scene'
            ? parsed.scene_prompt || parsed.video_prompt
            : undefined,
        catalog_product_id: dto.catalog_product_id,
        product_title: dto.product_title,
        category: dto.category,
        aspect_ratio: dto.aspect_ratio ?? '9:16',
        duration_seconds: dto.duration_seconds ?? 10,
        model_name: dto.model_name,
        camera_motion: dto.camera_motion,
      });
      singleJobId = started?.job_id ?? null;
    }
    const ok = multi ? jobIds.length > 0 : !!singleJobId;

    const content = await this.fetchContent(orgId, contentId);
    return this.updateContentAfterGeneration(orgId, contentId, {
      caption: parsed.caption,
      hashtags: parsed.hashtags ?? [],
      ai_model: 'claude+video',
      ai_prompt: parsed.video_prompt,
      ai_generation_time_ms: Date.now() - t0,
      status: ok ? 'generating' : 'failed',
      metadata: {
        ...(content.metadata as Record<string, unknown>),
        video_job_id: singleJobId,
        video_job_ids: multi ? jobIds : null,
        scene_prompt: parsed.scene_prompt ?? null,
        video_error: ok ? null : 'motor de vídeo indisponível (worker desligado?)',
      },
    });
  }

  /**
   * Poll do job de vídeo do reel. Quando o SaaS termina, anexa o vídeo
   * (media + capa) ao conteúdo e move pra pending_approval.
   */
  async pollReel(
    orgId: string,
    contentId: string,
  ): Promise<{ content: SocialContent; video_status: string }> {
    const content = await this.fetchContent(orgId, contentId);
    const meta = (content.metadata ?? {}) as {
      video_job_id?: string;
      video_job_ids?: string[];
    };

    // Já anexado (não é mais generating) → completed
    if (content.media?.length && content.status !== 'generating') {
      return { content, video_status: 'completed' };
    }
    const hasJob = !!meta.video_job_id || (meta.video_job_ids?.length ?? 0) > 0;
    if (!hasJob) {
      return { content, video_status: content.status === 'failed' ? 'failed' : 'unknown' };
    }

    const st = meta.video_job_ids?.length
      ? await this.bridge.getMultiSceneVideo(orgId, meta.video_job_ids)
      : await this.bridge.getSocialVideo(orgId, meta.video_job_id as string);
    if (!st) return { content, video_status: 'unknown' };

    if (st.status === 'completed' && st.public_url) {
      const updated = await this.updateContentAfterGeneration(orgId, contentId, {
        cover_image_url: st.preview_url ?? st.public_url,
        media: [
          {
            url: st.public_url,
            thumbnail_url: st.preview_url ?? undefined,
            width: 1080,
            height: 1920,
            source: 'generated_ai' as const,
          },
        ],
        status: 'pending_approval',
      });
      return { content: updated, video_status: 'completed' };
    }
    if (st.status === 'failed') {
      const updated = await this.updateContentAfterGeneration(orgId, contentId, {
        status: 'failed',
        metadata: { ...(content.metadata as Record<string, unknown>), video_error: st.error },
      });
      return { content: updated, video_status: 'failed' };
    }
    return { content, video_status: st.status };
  }

  // ─── Geração ad-hoc (sem calendário) ─────────────

  async createAndGeneratePost(
    orgId: string,
    dto: GeneratePostDto,
  ): Promise<SocialContent> {
    const { data, error } = await this.supabase.adminClient
      .from('social_contents')
      .insert({
        org_id: orgId,
        brand_id: dto.brand_id,
        calendar_id: dto.calendar_id ?? null,
        content_type: 'post',
        pillar: dto.pillar ?? null,
        title: dto.theme,
        channels: dto.channels ?? ['instagram'],
        related_product_id: dto.related_product_id ?? null,
        status: 'draft',
        metadata: {
          hook: dto.hook,
          brief: dto.theme,
          cta_suggested: dto.cta,
          visual_style: dto.visual_style,
        },
      })
      .select('id')
      .single();
    if (error) throw error;
    return this.generatePost(orgId, (data as { id: string }).id);
  }

  async createAndGenerateCarousel(
    orgId: string,
    dto: GenerateCarouselDto,
  ): Promise<SocialContent> {
    const { data, error } = await this.supabase.adminClient
      .from('social_contents')
      .insert({
        org_id: orgId,
        brand_id: dto.brand_id,
        calendar_id: dto.calendar_id ?? null,
        content_type: 'carousel',
        pillar: dto.pillar ?? null,
        title: dto.theme,
        channels: dto.channels ?? ['instagram'],
        related_product_id: dto.related_product_id ?? null,
        status: 'draft',
        metadata: {
          hook: dto.hook,
          brief: dto.theme,
          cta_suggested: dto.cta,
          visual_style: dto.visual_style,
          slide_count: dto.slide_count ?? 7,
          structure: dto.structure ?? 'free',
        },
      })
      .select('id')
      .single();
    if (error) throw error;
    return this.generateCarousel(orgId, (data as { id: string }).id);
  }

  // ─── Regeneração / refazer ──────────────────────

  async regenerate(
    orgId: string,
    contentId: string,
    dto: RegenerateContentDto,
  ): Promise<SocialContent> {
    const orig = await this.fetchContent(orgId, contentId);

    // Cria nova versão (parent aponta pra essa)
    const { data, error } = await this.supabase.adminClient
      .from('social_contents')
      .insert({
        org_id: orgId,
        brand_id: orig.brand_id,
        calendar_id: orig.calendar_id,
        content_type: orig.content_type,
        pillar: orig.pillar,
        title: orig.title,
        channels: orig.channels,
        version: orig.version + 1,
        parent_content_id: orig.id,
        status: 'draft',
        metadata: {
          ...orig.metadata,
          regeneration_instruction: dto.instruction,
          regeneration_scope: dto.scope ?? 'all',
        },
      })
      .select('id')
      .single();
    if (error) throw error;

    const newId = (data as { id: string }).id;

    // Caption-only: copia mídia da original e só refaz copy
    if (dto.scope === 'caption_only') {
      await this.supabase.adminClient
        .from('social_contents')
        .update({
          cover_image_url: orig.cover_image_url,
          media: orig.media,
          slides: orig.slides,
        })
        .eq('id', newId);
      return this.rewriteCaption(orgId, newId, dto.instruction ?? '');
    }

    return orig.content_type === 'carousel'
      ? this.generateCarousel(orgId, newId)
      : this.generatePost(orgId, newId);
  }

  async rewriteCaption(
    orgId: string,
    contentId: string,
    instruction: string,
  ): Promise<SocialContent> {
    const content = await this.fetchContent(orgId, contentId);
    const ctx = await this.brands.getContext(orgId, content.brand_id);
    const ctxBlock = buildBrandContextBlock(ctx);

    const userPrompt = [
      ctxBlock,
      '',
      `CAPTION ATUAL:\n${content.caption ?? ''}`,
      `INSTRUÇÃO: ${instruction || 'Reescreva mantendo a mensagem mas melhorando o engajamento'}`,
      '',
      'Retorne APENAS JSON: { "caption": string, "hashtags": [string] }',
    ].join('\n');

    const result = await this.llm.chat({
      orgId,
      feature: 'social_rewrite_caption',
      system: await this.prompts.getSystemPrompt(orgId, 'POST_SYSTEM_PROMPT', POST_SYSTEM_PROMPT),
      user: userPrompt,
      json_mode: true,
      max_tokens: 1000,
      temperature: 0.7,
    });
    const parsed = this.parseJson<{ caption?: string; hashtags?: string[] }>(
      result.text,
    );
    if (!parsed?.caption) throw new Error('Rewrite falhou');

    return this.updateContentAfterGeneration(orgId, contentId, {
      caption: parsed.caption,
      hashtags: parsed.hashtags ?? content.hashtags,
      status: 'pending_approval',
    });
  }

  async suggestImprovements(
    orgId: string,
    contentId: string,
  ): Promise<{ suggestions: string[] }> {
    const content = await this.fetchContent(orgId, contentId);
    const ctx = await this.brands.getContext(orgId, content.brand_id);

    const result = await this.llm.chat({
      orgId,
      feature: 'social_suggest_improvements',
      system: `Você é um analista de marketing. Receba um post e a marca, e dê 3-5 sugestões objetivas de melhoria. Retorne JSON: { "suggestions": [string] }`,
      user: [
        buildBrandContextBlock(ctx),
        '',
        `CAPTION: ${content.caption ?? ''}`,
        `HASHTAGS: ${(content.hashtags ?? []).join(' ')}`,
      ].join('\n'),
      json_mode: true,
      max_tokens: 800,
      temperature: 0.4,
    });
    const parsed = this.parseJson<{ suggestions?: string[] }>(result.text);
    return { suggestions: parsed?.suggestions ?? [] };
  }

  // ─── helpers internos ───────────────────────────

  private async fetchContent(
    orgId: string,
    contentId: string,
  ): Promise<SocialContent> {
    const { data } = await this.supabase.adminClient
      .from('social_contents')
      .select('*')
      .eq('id', contentId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (!data) throw new Error('Conteúdo não encontrado');
    return data as SocialContent;
  }

  private async markGenerating(contentId: string): Promise<void> {
    await this.supabase.adminClient
      .from('social_contents')
      .update({ status: 'generating' })
      .eq('id', contentId);
  }

  private async markFailed(contentId: string, reason: string): Promise<void> {
    await this.supabase.adminClient
      .from('social_contents')
      .update({
        status: 'failed',
        metadata: { failure_reason: reason },
      })
      .eq('id', contentId);
  }

  private async updateContentAfterGeneration(
    orgId: string,
    contentId: string,
    patch: Record<string, unknown>,
  ): Promise<SocialContent> {
    const { data, error } = await this.supabase.adminClient
      .from('social_contents')
      .update(patch)
      .eq('id', contentId)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialContent;
  }

  private parseJson<T>(raw: string): T | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
    const candidate = fenced ? fenced[1] : trimmed;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      const m = /\{[\s\S]*\}/.exec(candidate);
      if (m) {
        try {
          return JSON.parse(m[0]) as T;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  private isValidItem(item: unknown): item is CalendarItemDraft {
    if (!item || typeof item !== 'object') return false;
    const r = item as Record<string, unknown>;
    return (
      typeof r.date === 'string' &&
      typeof r.theme === 'string' &&
      typeof r.content_type === 'string' &&
      typeof r.pillar === 'string'
    );
  }

  private combineDateAndTime(date: string, time: string): string {
    const safeTime = /^\d{2}:\d{2}/.test(time) ? time : '11:00';
    return `${date}T${safeTime.slice(0, 5)}:00.000-03:00`;
  }

  private addDays(date: string, days: number): string {
    const d = new Date(date + 'T00:00:00.000Z');
    d.setUTCDate(d.getUTCDate() + days - 1);
    return d.toISOString().slice(0, 10);
  }
}

// Type guards exportados
export type { ContentPillar };
