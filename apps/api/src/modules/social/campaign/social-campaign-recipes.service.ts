import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type { SocialCampaignRecipe } from './social-campaign.types';
import type { UpsertRecipeDto } from './dto/campaign.dto';

/** Defaults da receita quando a org ainda não criou nenhuma. */
const RECIPE_DEFAULTS = {
  name: 'Receita padrão',
  num_reels: 3,
  num_carousels: 1,
  num_posts: 3,
  // estilos "fortes" (image-to-video entrega bem) por padrão
  allowed_video_styles: ['360', 'cinemagraph', 'hook_payoff', 'storytelling'],
  allowed_frameworks: ['dsb', 'aida', 'pas'],
  video_model: 'sora-2',
  video_duration_seconds: 8,
  channels: ['instagram'],
  cadence_days: 7,
  preferred_hour: 18,
  autonomy_level: 'approval' as const,
  max_cost_usd: 10,
};

@Injectable()
export class SocialCampaignRecipesService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string): Promise<SocialCampaignRecipe[]> {
    const { data, error } = await this.supabase.adminClient
      .from('social_campaign_recipes')
      .select('*')
      .eq('org_id', orgId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as SocialCampaignRecipe[];
  }

  async get(orgId: string, id: string): Promise<SocialCampaignRecipe> {
    const { data, error } = await this.supabase.adminClient
      .from('social_campaign_recipes')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Receita não encontrada');
    return data as SocialCampaignRecipe;
  }

  async getDefault(orgId: string): Promise<SocialCampaignRecipe | null> {
    const { data } = await this.supabase.adminClient
      .from('social_campaign_recipes')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_default', true)
      .maybeSingle();
    return (data as SocialCampaignRecipe) ?? null;
  }

  /** Garante uma receita default pra org (cria com defaults se não houver). */
  async ensureDefault(
    orgId: string,
    brandId?: string | null,
  ): Promise<SocialCampaignRecipe> {
    const existing = await this.getDefault(orgId);
    if (existing) return existing;
    return this.create(orgId, {
      ...RECIPE_DEFAULTS,
      brand_id: brandId ?? null,
      is_default: true,
    });
  }

  async create(
    orgId: string,
    dto: UpsertRecipeDto,
  ): Promise<SocialCampaignRecipe> {
    if (dto.is_default) await this.clearDefault(orgId);
    const { data, error } = await this.supabase.adminClient
      .from('social_campaign_recipes')
      .insert({
        org_id: orgId,
        brand_id: dto.brand_id ?? null,
        name: dto.name ?? RECIPE_DEFAULTS.name,
        num_reels: dto.num_reels ?? RECIPE_DEFAULTS.num_reels,
        num_carousels: dto.num_carousels ?? RECIPE_DEFAULTS.num_carousels,
        num_posts: dto.num_posts ?? RECIPE_DEFAULTS.num_posts,
        allowed_video_styles:
          dto.allowed_video_styles ?? RECIPE_DEFAULTS.allowed_video_styles,
        allowed_frameworks:
          dto.allowed_frameworks ?? RECIPE_DEFAULTS.allowed_frameworks,
        video_model: dto.video_model ?? RECIPE_DEFAULTS.video_model,
        video_duration_seconds:
          dto.video_duration_seconds ?? RECIPE_DEFAULTS.video_duration_seconds,
        channels: dto.channels ?? RECIPE_DEFAULTS.channels,
        cadence_days: dto.cadence_days ?? RECIPE_DEFAULTS.cadence_days,
        preferred_hour: dto.preferred_hour ?? RECIPE_DEFAULTS.preferred_hour,
        autonomy_level: dto.autonomy_level ?? RECIPE_DEFAULTS.autonomy_level,
        prioritize_high_margin: dto.prioritize_high_margin ?? false,
        prioritize_overstock: dto.prioritize_overstock ?? false,
        follow_radar: dto.follow_radar ?? false,
        use_ai_influencer: dto.use_ai_influencer ?? false,
        auto_on_new_product: dto.auto_on_new_product ?? false,
        max_cost_usd: dto.max_cost_usd ?? RECIPE_DEFAULTS.max_cost_usd,
        is_default: dto.is_default ?? false,
        is_active: dto.is_active ?? true,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialCampaignRecipe;
  }

  async update(
    orgId: string,
    id: string,
    dto: UpsertRecipeDto,
  ): Promise<SocialCampaignRecipe> {
    await this.get(orgId, id); // 404 se não for da org
    if (dto.is_default) await this.clearDefault(orgId);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) {
      if (v !== undefined) patch[k] = v;
    }
    const { data, error } = await this.supabase.adminClient
      .from('social_campaign_recipes')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialCampaignRecipe;
  }

  async remove(orgId: string, id: string): Promise<void> {
    await this.get(orgId, id);
    const { error } = await this.supabase.adminClient
      .from('social_campaign_recipes')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw error;
  }

  /** Desmarca a receita default atual (uma só default por org). */
  private async clearDefault(orgId: string): Promise<void> {
    await this.supabase.adminClient
      .from('social_campaign_recipes')
      .update({ is_default: false })
      .eq('org_id', orgId)
      .eq('is_default', true);
  }
}
