import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { EventsGateway } from '../../../gateways/events.gateway';
import { LlmService } from '../../../common/llm/llm.service';
import { SocialAiGeneratorService } from '../social-ai/social-ai-generator.service';
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
} from './social-campaign.types';
import type {
  GenerateCampaignDto,
  CampaignStyleSpec,
  CampaignFrameworkSpec,
} from './dto/campaign.dto';

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

@Injectable()
export class SocialCampaignService {
  private readonly log = new Logger(SocialCampaignService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly events: EventsGateway,
    private readonly llm: LlmService,
    private readonly ai: SocialAiGeneratorService,
    private readonly recipes: SocialCampaignRecipesService,
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
    cfg: { channels: string[]; videoModel: string; videoDuration: number },
  ): Promise<void> {
    const angles = await this.planAngles(orgId, dto, specs.length);
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
        if (spec.asset_type === 'reel') {
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
            video_mode: 'product_photo',
            style: spec.style?.id,
            style_label: spec.style?.label,
            style_prompt: spec.style?.prompt,
            framework: spec.framework?.id,
            framework_label: spec.framework?.label,
            framework_prompt: spec.framework?.prompt,
            aspect_ratio: '9:16',
            duration_seconds: cfg.videoDuration,
            model_name: cfg.videoModel,
            camera_motion: spec.style?.camera,
            channels: cfg.channels,
            multi_scene: !!dto.multi_scene,
            photo_urls: dto.product_photos,
          });
          actualCost += videoCostUsd(cfg.videoModel, cfg.videoDuration);
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

  // ─── Planejamento de ângulos (1 chamada de IA) ──

  private async planAngles(
    orgId: string,
    dto: GenerateCampaignDto,
    count: number,
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

    // Avança os reels que ainda estão gerando vídeo
    for (const a of assets) {
      if (a.status === 'generating' && a.asset_type === 'reel' && a.content_id) {
        try {
          const { video_status } = await this.ai.pollReel(orgId, a.content_id);
          if (video_status === 'completed') {
            await this.patchAsset(orgId, a.id, { status: 'ready' });
            a.status = 'ready';
          } else if (video_status === 'failed') {
            await this.patchAsset(orgId, a.id, {
              status: 'failed',
              error_message: 'motor de vídeo falhou',
            });
            a.status = 'failed';
          }
        } catch (e) {
          this.log.warn(`pollReel ${a.content_id}: ${(e as Error).message}`);
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
