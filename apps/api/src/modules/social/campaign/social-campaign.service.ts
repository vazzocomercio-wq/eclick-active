import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { asUuidOrNull } from '../../../common/uuid.util';
import { EventsGateway } from '../../../gateways/events.gateway';
import { LlmService } from '../../../common/llm/llm.service';
import { SocialAiGeneratorService } from '../social-ai/social-ai-generator.service';
import { BridgeService } from '../../bridge/bridge.service';
import type { CommercialSignal } from '../../bridge/bridge.types';
import { SocialAdBoostService } from '../boost/social-ad-boost.service';
import { SocialKnowledgeService } from '../prompts/social-knowledge.service';
import { SocialCampaignRecipesService } from './social-campaign-recipes.service';
import type {
  SocialContent,
  ContentPillar,
} from '../social.types';
import type { GenerateReelDto } from '../dto/content.dto';
import type {
  CampaignDetail,
  CampaignAssetType,
  SocialCampaign,
  SocialCampaignAsset,
  SocialCampaignRecipe,
} from './social-campaign.types';
import type {
  GenerateCampaignDto,
  GenerateBatchDto,
  GenerateLiveScriptDto,
  CampaignStyleSpec,
  CampaignFrameworkSpec,
} from './dto/campaign.dto';

export interface LiveScriptSegment {
  product: string;
  hook: string;
  talking_points: string[];
  offer: string;
  cta: string;
}
export interface LiveScript {
  intro: string;
  structure: string;
  segments: LiveScriptSegment[];
  engagement_prompts: string[];
  closing: string;
}

interface PlannedAngle {
  angle: string;
  hook: string;
  pillar: string;
}

interface AssetSpec {
  asset_type: CampaignAssetType;
  planned_index: number;
  style?: CampaignStyleSpec;
  framework?: CampaignFrameworkSpec;
}

const VALID_PILLARS: ContentPillar[] = [
  'educational',
  'promotional',
  'social_proof',
  'entertainment',
  'institutional',
  'engagement',
  'product',
  'behind_scenes',
];

const PLAN_SYSTEM_PROMPT = `Você é um estrategista de conteúdo para redes sociais de e-commerce.
Dado UM produto e a quantidade de peças desejada, gere ângulos de conteúdo DISTINTOS entre si — cada peça deve explorar um gancho diferente (benefício principal, dor/solução, destaque de característica, prova social, caso de uso no dia a dia, gatilho emocional/aspiracional, comparação, oferta).
Responda APENAS um JSON válido no formato:
{"pieces":[{"angle":"tema curto em pt-BR","hook":"primeira frase de impacto em pt-BR","pillar":"product|promotional|educational|social_proof|engagement|entertainment|institutional|behind_scenes"}]}
Gere EXATAMENTE o número de peças pedido. Sem texto fora do JSON.`;

const LIVE_SCRIPT_SYSTEM_PROMPT = `Você é coach de live commerce (estilo TikTok Shop / lives de venda no Instagram).
Dado uma marca e uma lista de produtos, monte um ROTEIRO de live de vendas pronto pra apresentar.
Responda APENAS JSON válido no formato:
{"intro":"abertura calorosa + o que vem na live (pt-BR)","structure":"como dividir o tempo (pt-BR)","segments":[{"product":"nome","hook":"frase de abertura do bloco","talking_points":["ponto 1","ponto 2","ponto 3"],"offer":"oferta/condição especial da live","cta":"chamada pra ação (comprar/clicar)"}],"engagement_prompts":["pergunta/enquete pra puxar comentário"],"closing":"encerramento + última chamada"}
Um segment por produto, na ordem dada. Linguagem falada, animada, persuasiva, honesta. Sem texto fora do JSON.`;

const AVATAR_SCRIPT_SYSTEM_PROMPT = `Você escreve roteiros FALADOS curtos para um avatar/criador apresentar um produto num reel (estilo UGC).
Dado um produto e um ângulo, escreva o que o avatar vai FALAR (~20-25s, ~55 palavras), natural e persuasivo, em pt-BR. Sem hashtags ou emojis no texto falado.
Responda APENAS JSON: {"spoken":"texto falado pt-BR","caption":"legenda curta pro post","hashtags":["#tag1","#tag2"]}
Sem texto fora do JSON.`;

@Injectable()
export class SocialCampaignService {
  private readonly log = new Logger(SocialCampaignService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly events: EventsGateway,
    private readonly llm: LlmService,
    private readonly ai: SocialAiGeneratorService,
    private readonly recipes: SocialCampaignRecipesService,
    private readonly bridge: BridgeService,
    private readonly boost: SocialAdBoostService,
    private readonly knowledge: SocialKnowledgeService,
  ) {}

  // ─── Disparo ────────────────────────────────────

  async generateCampaign(
    orgId: string,
    dto: GenerateCampaignDto,
  ): Promise<SocialCampaign> {
    if (!dto.brand_id) throw new BadRequestException('brand_id obrigatório');
    if (!dto.product_ref || !dto.product_name) {
      throw new BadRequestException('produto obrigatório');
    }

    // Receita (recipe_id como fallback dos valores não enviados)
    const recipe = dto.recipe_id
      ? await this.recipes.get(orgId, dto.recipe_id).catch(() => null)
      : await this.recipes.getDefault(orgId);

    const numReels = clamp(dto.num_reels ?? recipe?.num_reels ?? 3, 0, 10);
    const numCarousels = clamp(
      dto.num_carousels ?? recipe?.num_carousels ?? 1,
      0,
      5,
    );
    const numPosts = clamp(dto.num_posts ?? recipe?.num_posts ?? 3, 0, 10);
    const total = numReels + numCarousels + numPosts;
    if (total === 0) {
      throw new BadRequestException('Receita sem peças (tudo zerado)');
    }
    if (total > 20) {
      throw new BadRequestException('Receita pede peças demais (máx. 20)');
    }

    const channels = dto.channels ?? recipe?.channels ?? ['instagram'];
    const cadenceDays = clamp(
      dto.cadence_days ?? recipe?.cadence_days ?? 7,
      1,
      60,
    );
    const preferredHour = clamp(
      dto.preferred_hour ?? recipe?.preferred_hour ?? 18,
      0,
      23,
    );
    const autonomy =
      dto.autonomy_level ?? recipe?.autonomy_level ?? 'approval';
    const videoModel = dto.video_model ?? recipe?.video_model ?? 'sora-2';
    const videoDuration =
      dto.video_duration_seconds ?? recipe?.video_duration_seconds ?? 8;
    const styles = dto.video_styles ?? [];
    const frameworks = dto.frameworks ?? [];
    const maxCost = recipe?.max_cost_usd ?? 10;

    // Sinal comercial do produto (best-effort) → tempera o roteiro conforme
    // as flags da receita (margem/overstock/Radar).
    const signal =
      (await this.bridge.getCommercialSignals(orgId, [dto.product_ref]))[0] ??
      null;
    const commercialEmphasis = buildCommercialEmphasis(recipe, signal);
    const useInfluencer =
      dto.use_ai_influencer ?? recipe?.use_ai_influencer ?? false;
    const recipeMeta = recipe?.metadata ?? {};
    const influencerEngine =
      recipeMeta.influencer_engine === 'avatar' ? 'avatar' : 'scene';
    const avatarUrl = recipeMeta.influencer_avatar_url || undefined;
    const avatarVoice = recipeMeta.influencer_voice || undefined;
    const knowledgeContext = await this.buildKnowledgeContext(orgId, recipe, dto);

    // Estimativa de custo
    const reelCost = videoCostUsd(videoModel, videoDuration);
    const estimated = +(
      numReels * reelCost +
      numPosts * 0.02 +
      numCarousels * 0.05
    ).toFixed(2);
    if (estimated > maxCost) {
      throw new BadRequestException(
        `Custo estimado (US$${estimated}) acima do teto da receita (US$${maxCost}). Reduza a quantidade ou aumente o teto.`,
      );
    }

    // Cria a campanha
    const { data: campRow, error: campErr } = await this.supabase.adminClient
      .from('social_campaigns')
      .insert({
        org_id: orgId,
        brand_id: dto.brand_id,
        recipe_id: recipe?.id ?? null,
        name: dto.name ?? `Campanha — ${dto.product_name}`.slice(0, 120),
        product_ref: dto.product_ref,
        product_name: dto.product_name,
        product_image_url: dto.product_photo_url ?? null,
        trigger_source: 'manual',
        autonomy_level: autonomy,
        status: 'generating',
        planned_counts: {
          reels: numReels,
          carousels: numCarousels,
          posts: numPosts,
        },
        estimated_cost_usd: estimated,
        metadata: {
          video_model: videoModel,
          video_duration_seconds: videoDuration,
          channels,
          cadence_days: cadenceDays,
          preferred_hour: preferredHour,
          multi_scene: !!dto.multi_scene,
          commercial_signal: signal,
        },
      })
      .select('*')
      .single();
    if (campErr) throw campErr;
    const campaign = campRow as SocialCampaign;

    // Monta a lista de peças (reels → carrosséis → posts) com estilo/framework round-robin
    const specs: AssetSpec[] = [];
    for (let i = 0; i < numReels; i++) {
      specs.push({
        asset_type: 'reel',
        planned_index: i,
        style: styles.length ? styles[i % styles.length] : undefined,
        framework: frameworks.length
          ? frameworks[i % frameworks.length]
          : undefined,
      });
    }
    for (let i = 0; i < numCarousels; i++) {
      specs.push({
        asset_type: 'carousel',
        planned_index: i,
        framework: frameworks.length
          ? frameworks[i % frameworks.length]
          : undefined,
      });
    }
    for (let i = 0; i < numPosts; i++) {
      specs.push({
        asset_type: 'post',
        planned_index: i,
        framework: frameworks.length
          ? frameworks[i % frameworks.length]
          : undefined,
      });
    }

    // Insere os assets (pending) com slot de agenda já calculado
    const assetRows = specs.map((s, idx) => ({
      org_id: orgId,
      campaign_id: campaign.id,
      asset_type: s.asset_type,
      planned_index: s.planned_index,
      style_id: s.style?.id ?? null,
      framework_id: s.framework?.id ?? null,
      status: 'pending' as const,
      scheduled_for: slotFor(idx, specs.length, cadenceDays, preferredHour),
    }));
    const { data: insertedAssets, error: assetErr } = await this.supabase.adminClient
      .from('social_campaign_assets')
      .insert(assetRows)
      .select('id');
    if (assetErr) throw assetErr;
    const assetIds = (insertedAssets ?? []).map((a) => (a as { id: string }).id);

    // Dispara a geração em background (não bloqueia o HTTP)
    void this.runCampaign(orgId, campaign, dto, specs, assetIds, {
      channels,
      videoModel,
      videoDuration,
      commercialEmphasis,
      useInfluencer,
      influencerEngine,
      avatarUrl,
      avatarVoice,
      knowledgeContext,
    }).catch((e) => {
      this.log.error(`runCampaign falhou: ${(e as Error).message}`);
      void this.supabase.adminClient
        .from('social_campaigns')
        .update({ status: 'failed', error_message: (e as Error).message })
        .eq('id', campaign.id)
        .eq('org_id', orgId);
    });

    return campaign;
  }

  // ─── Execução em background ─────────────────────

  private async runCampaign(
    orgId: string,
    campaign: SocialCampaign,
    dto: GenerateCampaignDto,
    specs: AssetSpec[],
    assetIds: string[],
    cfg: {
      channels: string[];
      videoModel: string;
      videoDuration: number;
      commercialEmphasis?: string;
      useInfluencer?: boolean;
      influencerEngine?: 'scene' | 'avatar';
      avatarUrl?: string;
      avatarVoice?: string;
      knowledgeContext?: string;
    },
  ): Promise<void> {
    const angles = await this.planAngles(
      orgId,
      dto,
      specs.length,
      cfg.commercialEmphasis,
      cfg.knowledgeContext,
    );
    let actualCost = 0;

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const assetId = assetIds[i];
      const angle = angles[i] ?? {
        angle: dto.product_name,
        hook: '',
        pillar: 'product',
      };
      const pillar = normalizePillar(angle.pillar);

      await this.patchAsset(orgId, assetId, {
        status: 'generating',
        angle: angle.angle,
      });

      try {
        let content: SocialContent;
        const avatarMode =
          spec.asset_type === 'reel' &&
          cfg.useInfluencer &&
          cfg.influencerEngine === 'avatar';
        if (avatarMode) {
          content = await this.genAvatarReel(orgId, dto, angle, pillar, cfg);
          actualCost += 0.15; // ~custo D-ID por talk curto
        } else if (spec.asset_type === 'reel') {
          // Modo influenciador IA (cena): gera cena com um criador apresentando
          // o produto (UGC), em vez de só animar a foto.
          const stylePrompt = cfg.useInfluencer
            ? `${spec.style?.prompt ?? ''} — estilo UGC de criador: uma pessoa real/criador(a) apresentando e falando do produto, vibe selfie handheld, autêntico, luz natural`.trim()
            : spec.style?.prompt;
          content = await this.genReelWithRetry(orgId, {
            brand_id: dto.brand_id,
            theme: angle.angle,
            pillar,
            hook: angle.hook,
            catalog_product_id: dto.product_ref,
            product_title: dto.product_name,
            product_photo_url: dto.product_photo_url,
            product_description: dto.product_description,
            category: dto.category,
            video_mode: cfg.useInfluencer ? 'ai_scene' : 'product_photo',
            style: spec.style?.id,
            style_label: spec.style?.label,
            style_prompt: stylePrompt,
            framework: spec.framework?.id,
            framework_label: spec.framework?.label,
            framework_prompt: spec.framework?.prompt,
            aspect_ratio: '9:16',
            duration_seconds: cfg.videoDuration,
            model_name: cfg.videoModel,
            camera_motion: spec.style?.camera,
            channels: cfg.channels,
            multi_scene: !!dto.multi_scene && !cfg.useInfluencer,
            photo_urls: dto.product_photos,
          });
          actualCost += videoCostUsd(cfg.videoModel, cfg.videoDuration);
          if (cfg.useInfluencer) await this.appendAiDisclosure(orgId, content);
        } else if (spec.asset_type === 'carousel') {
          content = await this.ai.createAndGenerateCarousel(orgId, {
            brand_id: dto.brand_id,
            theme: angle.angle,
            pillar,
            hook: angle.hook,
            related_product_id: dto.product_ref,
            channels: cfg.channels,
            structure: 'free',
          });
          await this.applyProductCover(content.id, orgId, dto.product_photo_url);
          actualCost += 0.05;
        } else {
          content = await this.ai.createAndGeneratePost(orgId, {
            brand_id: dto.brand_id,
            theme: angle.angle,
            pillar,
            hook: angle.hook,
            related_product_id: dto.product_ref,
            channels: cfg.channels,
          });
          await this.applyProductPhoto(content.id, orgId, dto.product_photo_url);
          actualCost += 0.02;
        }

        // Liga o conteúdo à campanha
        await this.supabase.adminClient
          .from('social_contents')
          .update({ campaign_id: campaign.id })
          .eq('id', content.id)
          .eq('org_id', orgId);

        // Reel pode voltar 'failed' do motor de vídeo; senão fica gerando até pollReel
        const assetStatus =
          content.status === 'failed'
            ? 'failed'
            : spec.asset_type === 'reel' && content.status === 'generating'
              ? 'generating'
              : 'ready';
        await this.patchAsset(orgId, assetId, {
          content_id: content.id,
          status: assetStatus,
          error_message:
            content.status === 'failed'
              ? ((content.metadata as { video_error?: string })?.video_error ??
                'falha na geração')
              : null,
        });
      } catch (e) {
        this.log.error(
          `asset ${spec.asset_type} #${spec.planned_index} falhou: ${(e as Error).message}`,
        );
        await this.patchAsset(orgId, assetId, {
          status: 'failed',
          error_message: (e as Error).message?.slice(0, 400),
        });
      }
    }

    await this.supabase.adminClient
      .from('social_campaigns')
      .update({ actual_cost_usd: +actualCost.toFixed(2) })
      .eq('id', campaign.id)
      .eq('org_id', orgId);

    await this.recomputeStatus(orgId, campaign.id);

    // Autonomia total: agenda tudo que já está pronto (reels ainda em vídeo
    // serão agendados no pollReel via getCampaign quando ficarem prontos).
    if (campaign.autonomy_level === 'full_auto') {
      await this.approveCampaign(orgId, campaign.id, null).catch(() => null);
    }
  }

  /** Reel é o mais frágil (roteiro via LLM json_mode às vezes volta inválido).
   *  Tenta 2x antes de desistir. */
  private async genReelWithRetry(
    orgId: string,
    reelDto: GenerateReelDto,
  ): Promise<SocialContent> {
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const c = await this.ai.createAndGenerateReel(orgId, reelDto);
        if (c.status !== 'failed') return c;
        last = new Error(
          (c.metadata as { video_error?: string })?.video_error ??
            'reel retornou failed',
        );
      } catch (e) {
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error('falha ao gerar reel');
  }

  /** Reel via avatar falante (D-ID): roteiro falado → talk → mp4. */
  private async genAvatarReel(
    orgId: string,
    dto: GenerateCampaignDto,
    angle: PlannedAngle,
    pillar: ContentPillar,
    cfg: { channels: string[]; avatarUrl?: string; avatarVoice?: string },
  ): Promise<SocialContent> {
    let spoken = angle.angle;
    let caption = angle.angle;
    let hashtags: string[] = [];
    try {
      const r = await this.llm.chat({
        orgId,
        feature: 'social_avatar_script',
        system: AVATAR_SCRIPT_SYSTEM_PROMPT,
        user: [
          `PRODUTO: ${dto.product_name}`,
          dto.product_description
            ? `DESCRIÇÃO: ${dto.product_description.slice(0, 600)}`
            : '',
          `ÂNGULO: ${angle.angle}`,
          angle.hook ? `HOOK: ${angle.hook}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        json_mode: true,
        max_tokens: 600,
        temperature: 0.7,
      });
      const p = parseJson<{
        spoken?: string;
        caption?: string;
        hashtags?: string[];
      }>(r.text);
      if (p?.spoken) {
        spoken = p.spoken;
        caption = p.caption || p.spoken;
        hashtags = p.hashtags ?? [];
      }
    } catch (e) {
      this.log.warn(`avatar script fallback: ${(e as Error).message}`);
    }

    const { data, error } = await this.supabase.adminClient
      .from('social_contents')
      .insert({
        org_id: orgId,
        brand_id: dto.brand_id,
        content_type: 'reel',
        pillar,
        title: angle.angle,
        channels: cfg.channels,
        related_product_id: dto.product_ref,
        status: 'generating',
        metadata: { brief: angle.angle, video_engine: 'avatar' },
      })
      .select('id')
      .single();
    if (error) throw error;
    const contentId = (data as { id: string }).id;

    const started = await this.bridge.startAvatarVideo(orgId, {
      script: spoken,
      presenter_image_url: cfg.avatarUrl,
      voice_id: cfg.avatarVoice,
      name: dto.product_name,
    });
    const ok = !!started?.job_id;

    const { data: upd } = await this.supabase.adminClient
      .from('social_contents')
      .update({
        caption,
        hashtags,
        ai_model: 'd-id',
        status: ok ? 'generating' : 'failed',
        metadata: {
          brief: angle.angle,
          video_engine: 'avatar',
          avatar_job_id: started?.job_id ?? null,
          video_error: ok ? null : 'D-ID indisponível (sem chave/créditos?)',
        },
      })
      .eq('id', contentId)
      .eq('org_id', orgId)
      .select('*')
      .single();
    const content = upd as SocialContent;
    if (ok) await this.appendAiDisclosure(orgId, content);
    return content;
  }

  /** Poll do talk D-ID; quando pronto, anexa o mp4 ao conteúdo. */
  private async pollAvatarReel(
    orgId: string,
    content: SocialContent,
  ): Promise<'completed' | 'failed' | 'generating'> {
    const jobId = (content.metadata as { avatar_job_id?: string })?.avatar_job_id;
    if (!jobId) return content.status === 'failed' ? 'failed' : 'generating';
    const st = await this.bridge.getAvatarVideo(orgId, jobId);
    if (!st) return 'generating';
    if (st.status === 'completed' && st.public_url) {
      await this.supabase.adminClient
        .from('social_contents')
        .update({
          cover_image_url: st.public_url,
          media: [
            {
              url: st.public_url,
              width: 1080,
              height: 1920,
              source: 'generated_ai' as const,
            },
          ],
          status: 'pending_approval',
        })
        .eq('id', content.id)
        .eq('org_id', orgId);
      return 'completed';
    }
    if (st.status === 'failed') {
      await this.supabase.adminClient
        .from('social_contents')
        .update({
          status: 'failed',
          metadata: {
            ...(content.metadata as Record<string, unknown>),
            video_error: st.error,
          },
        })
        .eq('id', content.id)
        .eq('org_id', orgId);
      return 'failed';
    }
    return 'generating';
  }

  // ─── Planejamento de ângulos (1 chamada de IA) ──

  /** Monta o contexto da base de conhecimento (produto + URLs + imagens). */
  private async buildKnowledgeContext(
    orgId: string,
    recipe: SocialCampaignRecipe | null,
    dto: GenerateCampaignDto,
  ): Promise<string> {
    const parts: string[] = [];
    if ((recipe?.metadata as { use_product_data_kb?: boolean })?.use_product_data_kb) {
      parts.push(
        `DADOS DO PRODUTO (base forte): ${dto.product_name}${dto.category ? ` · categoria ${dto.category}` : ''}${dto.product_description ? ` — ${dto.product_description.slice(0, 600)}` : ''}`,
      );
    }
    try {
      const sources = await this.knowledge.getForScope(orgId, 'global');
      const urls = sources.filter((s) => s.source_type === 'url' && s.extracted_text);
      const imgs = sources.filter((s) => s.source_type === 'image');
      for (const u of urls.slice(0, 3)) {
        parts.push(`REFERÊNCIA (${u.title || u.value}): ${(u.extracted_text ?? '').slice(0, 800)}`);
      }
      if (imgs.length) {
        parts.push(
          `Há ${imgs.length} imagem(ns) de referência visual — siga a estética delas (mood, cores, composição).`,
        );
      }
    } catch (e) {
      this.log.warn(`buildKnowledgeContext: ${(e as Error).message}`);
    }
    return parts.join('\n');
  }

  private async planAngles(
    orgId: string,
    dto: GenerateCampaignDto,
    count: number,
    commercialEmphasis?: string,
    knowledgeContext?: string,
  ): Promise<PlannedAngle[]> {
    try {
      const { data: brand } = await this.supabase.adminClient
        .from('social_brands')
        .select('name, niche, value_proposition, target_audience, main_cta')
        .eq('id', dto.brand_id)
        .eq('org_id', orgId)
        .maybeSingle();
      const b = (brand ?? {}) as Record<string, string | null>;
      const user = [
        `MARCA: ${b.name ?? ''}${b.niche ? ` (nicho: ${b.niche})` : ''}`,
        b.value_proposition ? `PROPOSTA: ${b.value_proposition}` : '',
        b.target_audience ? `PÚBLICO: ${b.target_audience}` : '',
        b.main_cta ? `CTA: ${b.main_cta}` : '',
        '',
        `PRODUTO: ${dto.product_name}`,
        dto.category ? `CATEGORIA: ${dto.category}` : '',
        dto.product_description
          ? `DESCRIÇÃO: ${dto.product_description.slice(0, 800)}`
          : '',
        commercialEmphasis ? `\nDIREÇÃO COMERCIAL: ${commercialEmphasis}` : '',
        knowledgeContext ? `\nBASE DE CONHECIMENTO:\n${knowledgeContext}` : '',
        '',
        `Gere EXATAMENTE ${count} peças (ângulos distintos).`,
      ]
        .filter(Boolean)
        .join('\n');

      const result = await this.llm.chat({
        orgId,
        feature: 'social_campaign_plan',
        system: PLAN_SYSTEM_PROMPT,
        user,
        json_mode: true,
        max_tokens: 1500,
        temperature: 0.8,
      });
      const parsed = parseJson<{ pieces?: PlannedAngle[] }>(result.text);
      const pieces = parsed?.pieces ?? [];
      if (pieces.length >= count) return pieces.slice(0, count);
      // completa o que faltar com fallback
      return [...pieces, ...this.fallbackAngles(dto, count - pieces.length)];
    } catch (e) {
      this.log.warn(`planAngles fallback: ${(e as Error).message}`);
      return this.fallbackAngles(dto, count);
    }
  }

  private fallbackAngles(
    dto: GenerateCampaignDto,
    count: number,
  ): PlannedAngle[] {
    const templates = [
      { angle: `Conheça ${dto.product_name}`, pillar: 'product' },
      { angle: `Por que escolher ${dto.product_name}`, pillar: 'promotional' },
      { angle: `${dto.product_name} no dia a dia`, pillar: 'engagement' },
      { angle: `Detalhes de ${dto.product_name}`, pillar: 'educational' },
      { angle: `Transforme seu ambiente com ${dto.product_name}`, pillar: 'product' },
    ];
    return Array.from({ length: count }, (_, i) => {
      const t = templates[i % templates.length];
      return { angle: t.angle, hook: '', pillar: t.pillar };
    });
  }

  // ─── Detalhe + polling de reels ─────────────────

  async getCampaign(orgId: string, id: string): Promise<CampaignDetail> {
    const campaign = await this.fetchCampaign(orgId, id);
    const assets = await this.fetchAssets(orgId, id);
    const byId = new Map(
      (await this.fetchContents(orgId, assets)).map((c) => [c.id, c]),
    );

    // Avança os reels que ainda estão gerando vídeo (Kling/Sora vs avatar D-ID)
    for (const a of assets) {
      if (a.status === 'generating' && a.asset_type === 'reel' && a.content_id) {
        const c = byId.get(a.content_id);
        const isAvatar =
          (c?.metadata as { video_engine?: string })?.video_engine === 'avatar';
        try {
          let status: string;
          if (isAvatar && c) {
            status = await this.pollAvatarReel(orgId, c);
          } else {
            status = (await this.ai.pollReel(orgId, a.content_id)).video_status;
          }
          if (status === 'completed') {
            await this.patchAsset(orgId, a.id, { status: 'ready' });
            a.status = 'ready';
          } else if (status === 'failed') {
            await this.patchAsset(orgId, a.id, {
              status: 'failed',
              error_message: 'motor de vídeo falhou',
            });
            a.status = 'failed';
          }
        } catch (e) {
          this.log.warn(`poll reel ${a.content_id}: ${(e as Error).message}`);
        }
      }
    }

    const newStatus = await this.recomputeStatus(orgId, id);
    if (newStatus) campaign.status = newStatus;

    const contents = await this.fetchContents(orgId, assets);
    return { campaign, assets, contents };
  }

  async list(orgId: string): Promise<SocialCampaign[]> {
    const { data, error } = await this.supabase.adminClient
      .from('social_campaigns')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as SocialCampaign[];
  }

  // ─── Geração em lote ("tudo sozinho" em escala) ──

  /** Pega os top-N produtos por estratégia comercial e dispara 1 campanha
   *  por produto. A IA escolhe O QUE empurrar (margem/overstock/Radar). */
  async generateBatch(
    orgId: string,
    dto: GenerateBatchDto,
  ): Promise<{ campaigns: SocialCampaign[]; skipped: number }> {
    if (!dto.brand_id) throw new BadRequestException('brand_id obrigatório');
    const count = clamp(dto.count ?? 3, 1, 10);
    const candidates = await this.bridge.getCampaignCandidates(
      orgId,
      dto.strategy ?? 'mixed',
      count,
    );
    if (!candidates.length) {
      throw new BadRequestException(
        'Nenhum produto candidato encontrado (catálogo sem produtos com foto/preço?).',
      );
    }
    const campaigns: SocialCampaign[] = [];
    let skipped = 0;
    for (const c of candidates) {
      if (!c.product_photo_url) {
        skipped++;
        continue;
      }
      try {
        const camp = await this.generateCampaign(orgId, {
          brand_id: dto.brand_id,
          recipe_id: dto.recipe_id,
          product_ref: c.product_id,
          product_name: c.product_name,
          product_photo_url: c.product_photo_url,
          product_photos: c.product_photos,
          product_description: c.product_description ?? undefined,
          category: c.category ?? undefined,
          video_styles: dto.video_styles,
          frameworks: dto.frameworks,
          num_reels: dto.num_reels,
          num_posts: dto.num_posts,
          num_carousels: dto.num_carousels,
        });
        campaigns.push(camp);
      } catch (e) {
        this.log.warn(`batch produto ${c.product_id}: ${(e as Error).message}`);
        skipped++;
      }
    }
    return { campaigns, skipped };
  }

  // ─── Co-piloto de live (Fase 4) ──────────────────

  /** Gera um roteiro de live de vendas a partir de uma lista de produtos. */
  async generateLiveScript(
    orgId: string,
    dto: GenerateLiveScriptDto,
  ): Promise<LiveScript> {
    if (!dto.brand_id) throw new BadRequestException('brand_id obrigatório');
    if (!dto.products?.length) {
      throw new BadRequestException('selecione ao menos 1 produto');
    }
    const { data: brand } = await this.supabase.adminClient
      .from('social_brands')
      .select('name, niche, value_proposition, main_cta, tone_of_voice')
      .eq('id', dto.brand_id)
      .eq('org_id', orgId)
      .maybeSingle();
    const b = (brand ?? {}) as Record<string, string | null>;
    const productList = dto.products
      .slice(0, 20)
      .map(
        (p, i) =>
          `${i + 1}. ${p.name}${p.price != null ? ` (R$ ${Number(p.price).toFixed(2)})` : ''}`,
      )
      .join('\n');
    const user = [
      `MARCA: ${b.name ?? ''}${b.niche ? ` — ${b.niche}` : ''}`,
      b.value_proposition ? `PROPOSTA: ${b.value_proposition}` : '',
      b.main_cta ? `CTA da marca: ${b.main_cta}` : '',
      `DURAÇÃO ALVO: ${dto.duration_min ?? 30} min`,
      `OBJETIVO: ${dto.objective ?? 'vender e engajar'}`,
      '',
      'PRODUTOS (nesta ordem):',
      productList,
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.llm.chat({
      orgId,
      feature: 'social_live_script',
      system: LIVE_SCRIPT_SYSTEM_PROMPT,
      user,
      json_mode: true,
      max_tokens: 2500,
      temperature: 0.7,
    });
    const parsed = parseJson<LiveScript>(result.text);
    if (!parsed?.segments?.length) {
      throw new BadRequestException('IA não retornou um roteiro válido');
    }
    return parsed;
  }

  // ─── Fan-out de anúncios (Ad Boost) ──────────────

  /** Cria rascunhos de anúncio (Meta) pras peças prontas da campanha. */
  async createAdDrafts(
    orgId: string,
    id: string,
    actorId: string | null,
  ): Promise<{ created: number }> {
    const assets = await this.fetchAssets(orgId, id);
    let created = 0;
    for (const a of assets) {
      if (!a.content_id) continue;
      if (!['ready', 'scheduled', 'approved', 'published'].includes(a.status)) {
        continue;
      }
      try {
        await this.boost.createDraft(orgId, a.content_id, {
          user_id: actorId ?? undefined,
        });
        created++;
      } catch (e) {
        this.log.warn(`ad draft p/ ${a.content_id}: ${(e as Error).message}`);
      }
    }
    return { created };
  }

  // ─── Aprovação em lote ──────────────────────────

  async approveCampaign(
    orgId: string,
    id: string,
    actorId: string | null,
  ): Promise<CampaignDetail> {
    const assets = await this.fetchAssets(orgId, id);
    const campaign = await this.fetchCampaign(orgId, id);
    const channels =
      (campaign.metadata as { channels?: string[] })?.channels ?? ['instagram'];

    for (const a of assets) {
      if (!a.content_id) continue;
      if (a.status !== 'ready') continue;
      // Aprova + agenda no slot planejado
      await this.supabase.adminClient
        .from('social_contents')
        .update({
          status: 'scheduled',
          scheduled_for: a.scheduled_for,
          scheduled_channels: channels,
          approved_by: actorId,
          approved_at: new Date().toISOString(),
        })
        .eq('id', a.content_id)
        .eq('org_id', orgId);
      await this.patchAsset(orgId, a.id, { status: 'scheduled' });
    }

    await this.supabase.adminClient
      .from('social_campaigns')
      .update({ status: 'scheduled' })
      .eq('id', id)
      .eq('org_id', orgId);

    this.events.emitToOrg(orgId, 'social:campaign-updated', {
      campaign_id: id,
      status: 'scheduled',
    });
    return this.getCampaign(orgId, id);
  }

  async cancelCampaign(orgId: string, id: string): Promise<SocialCampaign> {
    await this.fetchCampaign(orgId, id);
    await this.supabase.adminClient
      .from('social_campaign_assets')
      .update({ status: 'failed', error_message: 'campanha cancelada' })
      .eq('campaign_id', id)
      .eq('org_id', orgId)
      .in('status', ['pending', 'generating']);
    const { data, error } = await this.supabase.adminClient
      .from('social_campaigns')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialCampaign;
  }

  // ─── Helpers ────────────────────────────────────

  private async recomputeStatus(
    orgId: string,
    id: string,
  ): Promise<SocialCampaign['status'] | null> {
    const campaign = await this.fetchCampaign(orgId, id);
    if (campaign.status === 'cancelled') return null;
    const assets = await this.fetchAssets(orgId, id);
    if (!assets.length) return null;

    const anyPending = assets.some(
      (a) => a.status === 'pending' || a.status === 'generating',
    );
    const allFailed = assets.every((a) => a.status === 'failed');
    const anyScheduled = assets.some(
      (a) => a.status === 'scheduled' || a.status === 'published',
    );

    let next: SocialCampaign['status'];
    if (anyPending) next = 'generating';
    else if (allFailed) next = 'failed';
    else if (anyScheduled && !assets.some((a) => a.status === 'ready'))
      next = 'scheduled';
    else next = 'ready_for_review';

    if (next !== campaign.status) {
      await this.supabase.adminClient
        .from('social_campaigns')
        .update({
          status: next,
          completed_at:
            next === 'ready_for_review' || next === 'failed'
              ? new Date().toISOString()
              : null,
        })
        .eq('id', id)
        .eq('org_id', orgId);
      this.events.emitToOrg(orgId, 'social:campaign-updated', {
        campaign_id: id,
        status: next,
      });
    }
    return next;
  }

  private async applyProductPhoto(
    contentId: string,
    orgId: string,
    photoUrl?: string,
  ): Promise<void> {
    if (!photoUrl || !photoUrl.startsWith('http')) return;
    await this.supabase.adminClient
      .from('social_contents')
      .update({
        cover_image_url: photoUrl,
        media: [
          { url: photoUrl, source: 'upload', width: 1080, height: 1080 },
        ],
      })
      .eq('id', contentId)
      .eq('org_id', orgId);
  }

  /** Selo de disclosure (Meta/TikTok exigem rotular conteúdo IA). */
  private async appendAiDisclosure(
    orgId: string,
    content: SocialContent,
  ): Promise<void> {
    const cap = content.caption ?? '';
    if (/🤖|intelig[êe]ncia artificial|\bIA\b|\bA\.?I\b/i.test(cap)) return;
    await this.supabase.adminClient
      .from('social_contents')
      .update({ caption: `${cap}\n\n🤖 Conteúdo criado com IA`.trim() })
      .eq('id', content.id)
      .eq('org_id', orgId);
  }

  private async applyProductCover(
    contentId: string,
    orgId: string,
    photoUrl?: string,
  ): Promise<void> {
    if (!photoUrl || !photoUrl.startsWith('http')) return;
    await this.supabase.adminClient
      .from('social_contents')
      .update({ cover_image_url: photoUrl })
      .eq('id', contentId)
      .eq('org_id', orgId);
  }

  private async patchAsset(
    orgId: string,
    assetId: string,
    patch: Partial<SocialCampaignAsset>,
  ): Promise<void> {
    await this.supabase.adminClient
      .from('social_campaign_assets')
      .update(patch)
      .eq('id', assetId)
      .eq('org_id', orgId);
  }

  private async fetchCampaign(
    orgId: string,
    id: string,
  ): Promise<SocialCampaign> {
    const { data, error } = await this.supabase.adminClient
      .from('social_campaigns')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Campanha não encontrada');
    return data as SocialCampaign;
  }

  private async fetchAssets(
    orgId: string,
    campaignId: string,
  ): Promise<SocialCampaignAsset[]> {
    const { data, error } = await this.supabase.adminClient
      .from('social_campaign_assets')
      .select('*')
      .eq('org_id', orgId)
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as SocialCampaignAsset[];
  }

  private async fetchContents(
    orgId: string,
    assets: SocialCampaignAsset[],
  ): Promise<SocialContent[]> {
    const ids = assets
      .map((a) => a.content_id)
      .filter((x): x is string => !!x);
    if (!ids.length) return [];
    const { data, error } = await this.supabase.adminClient
      .from('social_contents')
      .select('*')
      .eq('org_id', orgId)
      .in('id', ids);
    if (error) throw error;
    return (data ?? []) as SocialContent[];
  }
}

// ─── Funções puras ────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** Monta a "direção comercial" pro roteiro conforme flags da receita + sinal. */
function buildCommercialEmphasis(
  recipe: SocialCampaignRecipe | null,
  signal: CommercialSignal | null,
): string {
  if (!recipe || !signal) return '';
  const parts: string[] = [];
  if (recipe.prioritize_overstock && signal.is_overstock) {
    parts.push(
      `produto parado no estoque há ${signal.days_since_movement ?? '30+'} dias — crie senso de urgência/oferta pra girar`,
    );
  }
  if (recipe.prioritize_high_margin && (signal.margin_pct ?? 0) >= 40) {
    parts.push(
      'produto de boa margem — pode investir em ângulos premium/aspiracionais',
    );
  }
  if (recipe.follow_radar && signal.demand_trend === 'rising') {
    parts.push(
      'demanda em alta no mercado (Radar) — surfe a tendência, senso de oportunidade',
    );
  }
  return parts.join('; ');
}

/** Custo aproximado de um clipe de vídeo (US$) por modelo + duração. */
function videoCostUsd(model: string, duration: number): number {
  const m = (model || '').toLowerCase();
  let perSec = 0.12;
  if (m.startsWith('sora')) perSec = m.includes('pro') ? 0.3 : 0.1;
  else if (m.startsWith('veo')) perSec = m.includes('fast') ? 0.15 : 0.4;
  else if (m.startsWith('kling')) perSec = 0.08;
  return +(perSec * duration + 0.02).toFixed(2);
}

/** Distribui a peça `index` (de `total`) ao longo de `cadenceDays`, no horário
 *  preferido (BRT = UTC-3), a partir de amanhã. */
function slotFor(
  index: number,
  total: number,
  cadenceDays: number,
  preferredHour: number,
): string {
  const dayOffset = total <= 1 ? 0 : Math.floor((index * cadenceDays) / total);
  const now = new Date();
  const d = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1 + dayOffset,
      preferredHour + 3,
      0,
      0,
    ),
  );
  return d.toISOString();
}

function normalizePillar(p?: string): ContentPillar {
  const v = (p ?? '').toLowerCase() as ContentPillar;
  return VALID_PILLARS.includes(v) ? v : 'product';
}

function parseJson<T>(text: string): T | null {
  if (!text) return null;
  try {
    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    // tenta extrair o primeiro objeto {...}
    const m = text.match(/\{[\s\S]*\}/);
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
