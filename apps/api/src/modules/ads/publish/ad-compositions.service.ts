import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { LlmService } from '../../../common/llm/llm.service';
import { AdIntegrationsService } from '../ad-integrations.service';
import { MetaPublishService } from './meta-publish.service';
import type {
  AdComposition,
  AdCopy,
  AdObjective,
  MetaPage,
} from './ad-compositions.types';

const SELECT_COLS =
  'id, org_id, integration_id, platform, ad_account_id, page_id, instagram_actor_id, ' +
  'product_ref, name, objective, optimization_goal, status, targeting, budget_daily_cents, ' +
  'budget_total_cents, duration_days, bid_strategy, bid_amount_cents, special_ad_categories, ' +
  'ad_copies, destination_url, utm_params, external_campaign_id, external_adset_id, ' +
  'external_ad_ids, published_at, last_error, generation_metadata, created_by, created_at, updated_at';

export interface CreateCompositionDto {
  integration_id: string;
  name: string;
  objective?: AdObjective;
  page_id?: string;
  instagram_actor_id?: string;
  product_ref?: string;
  targeting?: Record<string, unknown>;
  budget_daily_cents?: number;
  budget_total_cents?: number;
  duration_days?: number;
  bid_strategy?: string;
  bid_amount_cents?: number;
  special_ad_categories?: string[];
  ad_copies?: AdCopy[];
  destination_url?: string;
  utm_params?: Record<string, string>;
}

export interface GenerateCompositionDto {
  integration_id: string;
  objective?: AdObjective;
  page_id?: string;
  instagram_actor_id?: string;
  destination_url?: string;
  product: {
    name: string;
    description?: string;
    price_brl?: number;
    category?: string;
    audience?: string;
    image_url?: string;
    product_ref?: string;
  };
}

/**
 * AdCompositionsService — orquestra o ciclo de vida das campanhas autoradas:
 * rascunho (manual ou IA) → revisão → publicação no Meta → pausa/retomada.
 *
 * Multi-tenant: todo método recebe orgId e filtra por ele (adminClient
 * ignora RLS). A integração é sempre validada como pertencente à org.
 */
@Injectable()
export class AdCompositionsService {
  private readonly logger = new Logger(AdCompositionsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
    private readonly integrations: AdIntegrationsService,
    private readonly publisher: MetaPublishService,
  ) {}

  // ────────────────────────────────────────────
  // CRUD
  // ────────────────────────────────────────────

  async list(orgId: string, status?: string): Promise<AdComposition[]> {
    let q = this.supabase.adminClient
      .from('ad_compositions')
      .select(SELECT_COLS)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as unknown as AdComposition[];
  }

  async get(orgId: string, id: string): Promise<AdComposition> {
    const { data, error } = await this.supabase.adminClient
      .from('ad_compositions')
      .select(SELECT_COLS)
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Composição não encontrada.');
    return data as unknown as AdComposition;
  }

  async create(
    orgId: string,
    userId: string,
    dto: CreateCompositionDto,
  ): Promise<AdComposition> {
    const integ = await this.resolveIntegration(orgId, dto.integration_id);
    const { data, error } = await this.supabase.adminClient
      .from('ad_compositions')
      .insert({
        org_id: orgId,
        integration_id: dto.integration_id,
        platform: 'meta',
        ad_account_id: integ.ad_account_id,
        page_id: dto.page_id ?? null,
        instagram_actor_id: dto.instagram_actor_id ?? null,
        product_ref: dto.product_ref ?? null,
        name: dto.name,
        objective: dto.objective ?? 'traffic',
        targeting: dto.targeting ?? {},
        budget_daily_cents: dto.budget_daily_cents ?? 3000,
        budget_total_cents: dto.budget_total_cents ?? null,
        duration_days: dto.duration_days ?? 7,
        bid_strategy: dto.bid_strategy ?? 'LOWEST_COST_WITHOUT_CAP',
        bid_amount_cents: dto.bid_amount_cents ?? null,
        special_ad_categories: dto.special_ad_categories ?? [],
        ad_copies: dto.ad_copies ?? [],
        destination_url: dto.destination_url ?? null,
        utm_params: dto.utm_params ?? {},
        status: 'draft',
        generation_metadata: { source: 'manual' },
        created_by: userId,
      })
      .select(SELECT_COLS)
      .single();
    if (error || !data) throw new InternalServerErrorException(error?.message ?? 'Falha ao criar');
    return data as unknown as AdComposition;
  }

  async update(
    orgId: string,
    id: string,
    patch: Partial<CreateCompositionDto> & { status?: string },
  ): Promise<AdComposition> {
    const existing = await this.get(orgId, id);
    if (['publishing', 'published'].includes(existing.status) && patch.status !== 'archived') {
      throw new BadRequestException(
        'Composição já publicada — pause/arquive antes de editar, ou crie uma nova.',
      );
    }
    const allowed: Record<string, unknown> = {};
    const fields: (keyof CreateCompositionDto)[] = [
      'name', 'objective', 'page_id', 'instagram_actor_id', 'product_ref',
      'targeting', 'budget_daily_cents', 'budget_total_cents', 'duration_days',
      'bid_strategy', 'bid_amount_cents', 'special_ad_categories', 'ad_copies',
      'destination_url', 'utm_params',
    ];
    for (const f of fields) {
      if (patch[f] !== undefined) allowed[f] = patch[f];
    }
    if (patch.status && ['draft', 'ready', 'archived'].includes(patch.status)) {
      allowed.status = patch.status;
    }
    if (Object.keys(allowed).length === 0) return existing;

    const { data, error } = await this.supabase.adminClient
      .from('ad_compositions')
      .update(allowed)
      .eq('org_id', orgId)
      .eq('id', id)
      .select(SELECT_COLS)
      .single();
    if (error || !data) throw new InternalServerErrorException(error?.message ?? 'Falha ao atualizar');
    return data as unknown as AdComposition;
  }

  /** "Remover" = arquivar (não deleta a row — preserva histórico/IDs externos). */
  async archive(orgId: string, id: string): Promise<void> {
    await this.get(orgId, id); // valida posse
    const { error } = await this.supabase.adminClient
      .from('ad_compositions')
      .update({ status: 'archived' })
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);
  }

  // ────────────────────────────────────────────
  // Páginas
  // ────────────────────────────────────────────

  listPages(orgId: string, integrationId: string): Promise<MetaPage[]> {
    return this.publisher.listPages(orgId, integrationId);
  }

  // ────────────────────────────────────────────
  // Geração com IA
  // ────────────────────────────────────────────

  async generate(
    orgId: string,
    userId: string,
    dto: GenerateCompositionDto,
  ): Promise<AdComposition> {
    const integ = await this.resolveIntegration(orgId, dto.integration_id);
    const objective = dto.objective ?? 'conversions';

    const out = await this.llm.chat({
      orgId,
      feature: 'ads_compose',
      system: buildSystemPrompt(),
      user: buildUserPrompt(dto, objective),
      max_tokens: 2000,
      json_mode: true,
      temperature: 0.6,
    });

    let parsed: GeneratedCampaign;
    try {
      parsed = JSON.parse(out.text) as GeneratedCampaign;
    } catch {
      throw new BadRequestException('A IA retornou um formato inválido — tente novamente.');
    }

    const dailyCents = Math.max(100, Math.round((parsed.budget_daily_brl ?? 30) * 100));
    const copies: AdCopy[] = (parsed.ad_copies ?? []).slice(0, 3).map((c, i) => ({
      variant: c.variant ?? String.fromCharCode(65 + i),
      headline: c.headline ?? '',
      primary_text: c.primary_text ?? '',
      description: c.description ?? '',
      cta: c.cta ?? 'SHOP_NOW',
      angle: c.angle,
      image_url: dto.product.image_url,
    }));
    if (copies.length === 0) {
      throw new BadRequestException('A IA não gerou nenhum anúncio — tente novamente.');
    }

    const { data, error } = await this.supabase.adminClient
      .from('ad_compositions')
      .insert({
        org_id: orgId,
        integration_id: dto.integration_id,
        platform: 'meta',
        ad_account_id: integ.ad_account_id,
        page_id: dto.page_id ?? null,
        instagram_actor_id: dto.instagram_actor_id ?? null,
        product_ref: dto.product.product_ref ?? null,
        name: parsed.campaign_name?.slice(0, 120) ?? `${dto.product.name.slice(0, 40)} — Meta`,
        objective,
        targeting: parsed.targeting ?? {},
        budget_daily_cents: dailyCents,
        budget_total_cents: parsed.budget_total_brl ? Math.round(parsed.budget_total_brl * 100) : null,
        duration_days: parsed.duration_days ?? 7,
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        special_ad_categories: [],
        ad_copies: copies,
        destination_url: dto.destination_url ?? parsed.destination_url ?? null,
        utm_params: parsed.utm_params ?? {},
        status: 'draft',
        generation_metadata: {
          source: 'ia',
          model: out.interaction_id ? 'logged' : 'unknown',
          interaction_id: out.interaction_id,
          estimated_results: parsed.estimated_results ?? null,
        },
        created_by: userId,
      })
      .select(SELECT_COLS)
      .single();
    if (error || !data) throw new InternalServerErrorException(error?.message ?? 'Falha ao salvar');
    return data as unknown as AdComposition;
  }

  // ────────────────────────────────────────────
  // Publicação / pause / resume
  // ────────────────────────────────────────────

  async publish(orgId: string, id: string): Promise<AdComposition> {
    const comp = await this.get(orgId, id);
    if (comp.external_campaign_id) {
      throw new BadRequestException('Esta composição já foi publicada no Meta.');
    }
    if (!['draft', 'ready', 'failed'].includes(comp.status)) {
      throw new BadRequestException(`Não dá pra publicar uma composição com status "${comp.status}".`);
    }

    await this.setStatus(orgId, id, 'publishing');

    try {
      const result = await this.publisher.publishComposition(comp);
      const { data, error } = await this.supabase.adminClient
        .from('ad_compositions')
        .update({
          status: 'published',
          external_campaign_id: result.campaign_id,
          external_adset_id: result.adset_id,
          external_ad_ids: result.ad_ids,
          published_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('org_id', orgId)
        .eq('id', id)
        .select(SELECT_COLS)
        .single();
      if (error || !data) throw new InternalServerErrorException(error?.message ?? 'Falha ao gravar publicação');
      this.logger.log(`[publish] org=${orgId} comp=${id} → campaign ${result.campaign_id} (PAUSED)`);
      return data as unknown as AdComposition;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.supabase.adminClient
        .from('ad_compositions')
        .update({ status: 'failed', last_error: msg.slice(0, 500) })
        .eq('org_id', orgId)
        .eq('id', id);
      throw err;
    }
  }

  async pause(orgId: string, id: string): Promise<AdComposition> {
    const comp = await this.requirePublished(orgId, id);
    await this.publisher.setCampaignStatus(orgId, comp.integration_id, comp.external_campaign_id!, 'PAUSED');
    return this.setStatus(orgId, id, 'paused');
  }

  async resume(orgId: string, id: string): Promise<AdComposition> {
    const comp = await this.requirePublished(orgId, id);
    await this.publisher.setCampaignStatus(orgId, comp.integration_id, comp.external_campaign_id!, 'ACTIVE');
    return this.setStatus(orgId, id, 'published');
  }

  // ────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────

  private async requirePublished(orgId: string, id: string): Promise<AdComposition> {
    const comp = await this.get(orgId, id);
    if (!comp.external_campaign_id) {
      throw new BadRequestException('Composição ainda não publicada no Meta.');
    }
    return comp;
  }

  private async setStatus(orgId: string, id: string, status: string): Promise<AdComposition> {
    const { data, error } = await this.supabase.adminClient
      .from('ad_compositions')
      .update({ status })
      .eq('org_id', orgId)
      .eq('id', id)
      .select(SELECT_COLS)
      .single();
    if (error || !data) throw new InternalServerErrorException(error?.message ?? 'Falha ao mudar status');
    return data as unknown as AdComposition;
  }

  /** Valida que a integração é da org e está ativa; devolve ad_account_id. */
  private async resolveIntegration(
    orgId: string,
    integrationId: string,
  ): Promise<{ ad_account_id: string }> {
    const list = await this.integrations.list(orgId);
    const found = list.find((i) => i.id === integrationId);
    if (!found) {
      throw new NotFoundException('Conta de anúncios não encontrada nesta organização.');
    }
    if (found.platform !== 'meta') {
      throw new BadRequestException('Publicação só suporta contas Meta nesta versão.');
    }
    if (found.status !== 'active') {
      throw new BadRequestException(
        `A conta "${found.account_name ?? found.ad_account_id}" está com status "${found.status}". Re-conecte em Integrações.`,
      );
    }
    return { ad_account_id: found.ad_account_id };
  }
}

// ────────────────────────────────────────────
// IA — prompts + shape
// ────────────────────────────────────────────

interface GeneratedCampaign {
  campaign_name?: string;
  targeting?: Record<string, unknown>;
  budget_daily_brl?: number;
  budget_total_brl?: number;
  duration_days?: number;
  destination_url?: string;
  utm_params?: Record<string, string>;
  estimated_results?: Record<string, number>;
  ad_copies?: Array<{
    variant?: string;
    headline?: string;
    primary_text?: string;
    description?: string;
    cta?: string;
    angle?: string;
  }>;
}

function buildSystemPrompt(): string {
  return [
    'Você é um especialista em Meta Ads (Facebook/Instagram) para e-commerce brasileiro.',
    'Receba um produto e gere uma campanha COMPLETA, pronta para revisão e publicação.',
    '',
    'Regras:',
    '- Português do Brasil, copy direto e persuasivo, respeitando limites do Meta',
    '  (headline ~40 chars, primary_text até ~125 chars antes do "ver mais").',
    '- Gere 3 variações (A/B/C) com ângulos psicológicos DISTINTOS (ex: prova social,',
    '  escassez, benefício prático).',
    '- CTA válido do Meta: SHOP_NOW, LEARN_MORE, SIGN_UP, ORDER_NOW, GET_OFFER.',
    '- targeting no formato do Meta: { age_min, age_max, genders:[1,2]|[], geo_locations:',
    '  { countries:["BR"] }, interests:[{ id, name }] }. Se não souber IDs de interesse,',
    '  deixe interests:[] (não invente IDs).',
    '- Orçamento realista pra PME brasileira (R$20–100/dia).',
    '',
    'Responda SOMENTE com JSON válido neste shape:',
    '{ "campaign_name": str, "targeting": {...}, "budget_daily_brl": num,',
    '  "budget_total_brl": num, "duration_days": num, "destination_url": str|null,',
    '  "utm_params": {...}, "estimated_results": { "reach": num, "clicks": num },',
    '  "ad_copies": [ { "variant":"A", "headline":str, "primary_text":str,',
    '  "description":str, "cta":str, "angle":str } ] }',
  ].join('\n');
}

function buildUserPrompt(dto: GenerateCompositionDto, objective: AdObjective): string {
  const p = dto.product;
  const lines = [
    `Objetivo da campanha: ${objective}`,
    `Produto: ${p.name}`,
  ];
  if (p.description) lines.push(`Descrição: ${p.description}`);
  if (p.price_brl) lines.push(`Preço: R$ ${p.price_brl.toFixed(2)}`);
  if (p.category) lines.push(`Categoria: ${p.category}`);
  if (p.audience) lines.push(`Público-alvo: ${p.audience}`);
  if (dto.destination_url) lines.push(`URL de destino: ${dto.destination_url}`);
  lines.push('', 'Gere a campanha agora.');
  return lines.join('\n');
}
