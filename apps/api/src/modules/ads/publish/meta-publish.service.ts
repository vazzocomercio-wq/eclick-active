import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AdIntegrationsService } from '../ad-integrations.service';
import type {
  AdComposition,
  AdCopy,
  AdObjective,
  MetaPage,
  PublishResult,
} from './ad-compositions.types';

/**
 * MetaPublishService — camada de ESCRITA na Marketing API do Meta.
 *
 * Diferente do MetaConnector (Bloco C, só leitura), aqui CRIAMOS objetos
 * no Meta: Campaign → Ad Set → Ad(s). Reusa o token vivo de ad_integrations
 * (que já consentiu `ads_management`) via AdIntegrationsService.getAccessToken.
 *
 * Princípios de segurança operacional:
 *   - SEMPRE cria PAUSED. Nada gasta dinheiro sem o user ativar.
 *   - Token nunca sai daqui; resolvido por chamada, não cacheado.
 *   - Erros do Graph viram BadRequestException com mensagem PT-BR.
 *
 * Onda 1 (MVP): link ad (object_story_spec.link_data) com imagem única.
 * Carousel/Video/DPA/CAPI/Custom Audiences = ondas seguintes.
 */

const API_VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

class MetaWriteError extends Error {
  constructor(
    readonly status: number,
    readonly fbCode: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'MetaWriteError';
  }
}

@Injectable()
export class MetaPublishService {
  private readonly logger = new Logger(MetaPublishService.name);

  constructor(private readonly integrations: AdIntegrationsService) {}

  // ────────────────────────────────────────────
  // Páginas elegíveis (assinatura do anúncio)
  // ────────────────────────────────────────────

  /** Lista as Páginas do Facebook que o user administra (necessário no creative). */
  async listPages(orgId: string, integrationId: string): Promise<MetaPage[]> {
    const token = await this.integrations.getAccessToken(orgId, integrationId);
    const url =
      `${GRAPH}/me/accounts?fields=id,name,instagram_business_account{id}` +
      `&limit=100&access_token=${encodeURIComponent(token)}`;
    const json = await this.httpGet<{
      data?: Array<{
        id: string;
        name?: string;
        instagram_business_account?: { id?: string };
      }>;
    }>(url);
    return (json.data ?? []).map((p) => ({
      id: p.id,
      name: p.name ?? '(sem nome)',
      instagram_actor_id: p.instagram_business_account?.id ?? null,
    }));
  }

  // ────────────────────────────────────────────
  // Publicação completa
  // ────────────────────────────────────────────

  /**
   * Publica a composição inteira no Meta (Campaign + AdSet + N Ads).
   * Tudo PAUSED. Retorna os IDs externos pra persistir.
   */
  async publishComposition(comp: AdComposition): Promise<PublishResult> {
    const format = comp.creative_format ?? 'image';
    const promoting = !!comp.object_story_id; // promover post já publicado

    if (!promoting && !comp.page_id) {
      throw new BadRequestException(
        'Selecione uma Página do Facebook antes de publicar (o anúncio precisa de uma Página que o assine).',
      );
    }
    this.assertCreativePresent(comp, format, promoting);

    const token = await this.integrations.getAccessToken(comp.org_id, comp.integration_id);
    const accountId = comp.ad_account_id.startsWith('act_')
      ? comp.ad_account_id
      : `act_${comp.ad_account_id}`;

    // 1. Campaign
    let campaignId: string;
    try {
      campaignId = await this.createCampaign(token, accountId, comp);
    } catch (err) {
      throw this.toHttpError(err);
    }

    // 2. Ad Set
    let adsetId: string;
    try {
      adsetId = await this.createAdSet(token, accountId, comp, campaignId);
    } catch (err) {
      await this.safeDelete(token, campaignId); // rollback campaign órfã
      throw this.toHttpError(err);
    }

    // 3. Anúncio(s) — por formato/origem
    const adIds: string[] = [];
    const adErrors: string[] = [];
    try {
      if (promoting) {
        adIds.push(await this.createAdFromStory(token, accountId, comp, adsetId, comp.object_story_id!));
      } else if (format === 'carousel') {
        adIds.push(await this.createCarouselAd(token, accountId, comp, adsetId));
      } else if (format === 'video' || format === 'reels') {
        adIds.push(await this.createVideoAd(token, accountId, comp, adsetId));
      } else {
        // imagem — 1 ad por variante (A/B/C), tolera falha parcial
        const copiesWithHash = await this.ensureImageHashes(token, accountId, comp.ad_copies);
        for (const copy of copiesWithHash) {
          try {
            adIds.push(await this.createAd(token, accountId, comp, adsetId, copy));
          } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            adErrors.push(`var ${copy.variant}: ${m}`);
            this.logger.warn(`[publish] ad variant ${copy.variant} falhou: ${m}`);
          }
        }
      }
    } catch (err) {
      adErrors.push(err instanceof Error ? err.message : String(err));
    }

    if (adIds.length === 0) {
      await this.safeDelete(token, adsetId);
      await this.safeDelete(token, campaignId);
      throw new BadRequestException(
        `Nenhum anúncio criado no Meta. Motivo: ${adErrors[0] ?? 'desconhecido — verifique mídia, copy e a Página.'}`,
      );
    }

    return { campaign_id: campaignId, adset_id: adsetId, ad_ids: adIds };
  }

  /** Garante que há criativo pro formato escolhido (pré-Graph). */
  private assertCreativePresent(comp: AdComposition, format: string, promoting: boolean): void {
    if (promoting) return; // o post existente já carrega o criativo
    if (!comp.destination_url) {
      throw new BadRequestException('Defina a URL de destino do anúncio.');
    }
    if (format === 'image' && !comp.ad_copies?.length) {
      throw new BadRequestException('A composição não tem nenhum anúncio (copy).');
    }
    if (format === 'carousel' && (comp.cards?.length ?? 0) < 2) {
      throw new BadRequestException('Carrossel precisa de ao menos 2 cards.');
    }
    if ((format === 'video' || format === 'reels') && !comp.video?.url && !comp.video?.video_id) {
      throw new BadRequestException('Anúncio de vídeo/Reels precisa de um vídeo.');
    }
  }

  // ────────────────────────────────────────────
  // Builders por formato (Onda 2)
  // ────────────────────────────────────────────

  /** Promove um post FB já publicado (mantém engajamento). Qualquer formato. */
  private async createAdFromStory(
    token: string,
    accountId: string,
    comp: AdComposition,
    adsetId: string,
    objectStoryId: string,
  ): Promise<string> {
    const json = await this.httpPost<{ id?: string }>(`${GRAPH}/${accountId}/ads`, {
      name: `${comp.name} — post`,
      adset_id: adsetId,
      creative: { object_story_id: objectStoryId },
      status: 'PAUSED',
      access_token: token,
    });
    if (!json.id) throw new Error('Meta não retornou id do ad (promo post)');
    return json.id;
  }

  /** Carrossel: 1 ad com N cards (child_attachments). */
  private async createCarouselAd(
    token: string,
    accountId: string,
    comp: AdComposition,
    adsetId: string,
  ): Promise<string> {
    const copy = comp.ad_copies?.[0];
    const childAttachments: Array<Record<string, unknown>> = [];
    for (const card of comp.cards ?? []) {
      let imageHash = card.image_hash;
      if (!imageHash && card.image_url) {
        try {
          imageHash = await this.uploadImageFromUrl(token, accountId, card.image_url);
        } catch {
          /* cai no picture URL */
        }
      }
      const att: Record<string, unknown> = {
        link: card.link ?? comp.destination_url,
        name: card.headline ?? copy?.headline ?? '',
        description: card.description ?? '',
      };
      if (imageHash) att.image_hash = imageHash;
      else if (card.image_url) att.picture = card.image_url;
      childAttachments.push(att);
    }

    const linkData: Record<string, unknown> = {
      link: comp.destination_url,
      message: copy?.primary_text ?? '',
      child_attachments: childAttachments,
      multi_share_optimized: true,
      multi_share_end_card: true,
    };
    if (copy?.cta) linkData.call_to_action = { type: copy.cta };

    const json = await this.httpPost<{ id?: string }>(`${GRAPH}/${accountId}/ads`, {
      name: `${comp.name} — carrossel`,
      adset_id: adsetId,
      creative: { object_story_spec: { page_id: comp.page_id, link_data: linkData } },
      status: 'PAUSED',
      access_token: token,
    });
    if (!json.id) throw new Error('Meta não retornou id do ad (carrossel)');
    return json.id;
  }

  /** Vídeo / Reels: faz upload (se preciso) e cria 1 ad com video_data. */
  private async createVideoAd(
    token: string,
    accountId: string,
    comp: AdComposition,
    adsetId: string,
  ): Promise<string> {
    const copy = comp.ad_copies?.[0];
    let videoId = comp.video?.video_id;
    if (!videoId) {
      if (!comp.video?.url) throw new Error('vídeo sem URL nem id');
      videoId = await this.uploadVideoFromUrl(token, accountId, comp.video.url);
    }

    const videoData: Record<string, unknown> = {
      video_id: videoId,
      message: copy?.primary_text ?? '',
      title: copy?.headline ?? '',
      call_to_action: {
        type: copy?.cta ?? 'LEARN_MORE',
        value: { link: comp.destination_url },
      },
    };
    // Meta exige uma thumbnail pro video_data.
    if (comp.video?.thumbnail_url) videoData.image_url = comp.video.thumbnail_url;

    const json = await this.httpPost<{ id?: string }>(`${GRAPH}/${accountId}/ads`, {
      name: `${comp.name} — vídeo`,
      adset_id: adsetId,
      creative: { object_story_spec: { page_id: comp.page_id, video_data: videoData } },
      status: 'PAUSED',
      access_token: token,
    });
    if (!json.id) throw new Error('Meta não retornou id do ad (vídeo)');
    return json.id;
  }

  /** Sobe um vídeo via /advideos a partir de uma URL (Meta busca o arquivo). */
  private async uploadVideoFromUrl(token: string, accountId: string, url: string): Promise<string> {
    const json = await this.httpPost<{ id?: string }>(`${GRAPH}/${accountId}/advideos`, {
      file_url: url,
      access_token: token,
    });
    if (!json.id) throw new Error('Meta não retornou id do vídeo (/advideos)');
    return json.id;
  }

  // ────────────────────────────────────────────
  // Pause / Resume (pós-publicação)
  // ────────────────────────────────────────────

  async setCampaignStatus(
    orgId: string,
    integrationId: string,
    campaignId: string,
    status: 'ACTIVE' | 'PAUSED',
  ): Promise<void> {
    const token = await this.integrations.getAccessToken(orgId, integrationId);
    await this.httpPost(`${GRAPH}/${campaignId}`, { status, access_token: token });
  }

  // ────────────────────────────────────────────
  // Image upload (/adimages → hash)
  // ────────────────────────────────────────────

  private async ensureImageHashes(
    token: string,
    accountId: string,
    copies: AdCopy[],
  ): Promise<AdCopy[]> {
    const out: AdCopy[] = [];
    const cache = new Map<string, string>(); // url → hash (dedup mesma imagem)
    for (const copy of copies) {
      if (copy.image_hash || !copy.image_url) {
        out.push(copy);
        continue;
      }
      try {
        let hash = cache.get(copy.image_url);
        if (!hash) {
          hash = await this.uploadImageFromUrl(token, accountId, copy.image_url);
          cache.set(copy.image_url, hash);
        }
        out.push({ ...copy, image_hash: hash });
      } catch (err) {
        this.logger.warn(
          `[publish] upload imagem falhou (${copy.image_url}): ${err instanceof Error ? err.message : String(err)} — usando picture URL`,
        );
        out.push(copy); // sem hash → cai no fallback picture=URL no createAd
      }
    }
    return out;
  }

  /** Baixa a imagem e sobe pro /adimages; retorna o hash. */
  private async uploadImageFromUrl(
    token: string,
    accountId: string,
    imageUrl: string,
  ): Promise<string> {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      throw new Error(`não consegui baixar a imagem (HTTP ${imgRes.status})`);
    }
    const bytes = Buffer.from(await imgRes.arrayBuffer()).toString('base64');
    const json = await this.httpPost<{
      images?: Record<string, { hash?: string }>;
    }>(`${GRAPH}/${accountId}/adimages`, { bytes, access_token: token });
    const first = Object.values(json.images ?? {})[0];
    if (!first?.hash) throw new Error('Meta não retornou hash da imagem');
    return first.hash;
  }

  // ────────────────────────────────────────────
  // Campaign / AdSet / Ad
  // ────────────────────────────────────────────

  private async createCampaign(
    token: string,
    accountId: string,
    comp: AdComposition,
  ): Promise<string> {
    const json = await this.httpPost<{ id?: string }>(`${GRAPH}/${accountId}/campaigns`, {
      name: comp.name,
      objective: mapObjective(comp.objective),
      status: 'PAUSED',
      special_ad_categories: comp.special_ad_categories ?? [],
      // Orçamento fica no ad set (não usamos CBO). O Meta exige declarar
      // explicitamente que os ad sets NÃO compartilham orçamento.
      is_adset_budget_sharing_enabled: false,
      access_token: token,
    });
    if (!json.id) throw new Error('Meta não retornou id da campaign');
    return json.id;
  }

  private async createAdSet(
    token: string,
    accountId: string,
    comp: AdComposition,
    campaignId: string,
  ): Promise<string> {
    const startTime = new Date(Date.now() + 60_000).toISOString();
    const endTime = new Date(
      Date.now() + comp.duration_days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const body: Record<string, unknown> = {
      name: `${comp.name} — AdSet`,
      campaign_id: campaignId,
      daily_budget: Math.round(comp.budget_daily_cents),
      billing_event: 'IMPRESSIONS',
      optimization_goal: comp.optimization_goal ?? mapOptimizationGoal(comp.objective),
      bid_strategy: comp.bid_strategy,
      targeting: normalizeTargeting(comp.targeting),
      start_time: startTime,
      end_time: endTime,
      status: 'PAUSED',
      access_token: token,
    };
    // Cap de lance só quando a estratégia exige.
    if (comp.bid_strategy !== 'LOWEST_COST_WITHOUT_CAP' && comp.bid_amount_cents) {
      body.bid_amount = Math.round(comp.bid_amount_cents);
    }

    const json = await this.httpPost<{ id?: string }>(`${GRAPH}/${accountId}/adsets`, body);
    if (!json.id) throw new Error('Meta não retornou id do ad set');
    return json.id;
  }

  private async createAd(
    token: string,
    accountId: string,
    comp: AdComposition,
    adsetId: string,
    copy: AdCopy,
  ): Promise<string> {
    const linkData: Record<string, unknown> = {
      message: copy.primary_text,
      link: comp.destination_url,
      name: copy.headline,
      description: copy.description ?? '',
      call_to_action: { type: copy.cta || 'LEARN_MORE' },
    };
    if (copy.image_hash) linkData.image_hash = copy.image_hash;
    else if (copy.image_url) linkData.picture = copy.image_url;

    const objectStorySpec: Record<string, unknown> = {
      page_id: comp.page_id,
      link_data: linkData,
    };
    // NOTA: NÃO enviamos instagram_actor_id no Onda 1. O id de
    // instagram_business_account vindo de /me/accounts NÃO é o "actor id"
    // que o creative espera (Graph recusa com #100). As placements do IG
    // ainda são servidas via a Página conectada. Controle explícito do
    // ator IG (lookup em /act_x/instagram_accounts) fica pra onda futura.

    const json = await this.httpPost<{ id?: string }>(`${GRAPH}/${accountId}/ads`, {
      name: `${comp.name} — var ${copy.variant}`,
      adset_id: adsetId,
      creative: { object_story_spec: objectStorySpec },
      status: 'PAUSED',
      access_token: token,
    });
    if (!json.id) throw new Error('Meta não retornou id do ad');
    return json.id;
  }

  /** DELETE best-effort — não lança (usado em rollback). */
  private async safeDelete(token: string, nodeId: string): Promise<void> {
    try {
      await fetch(`${GRAPH}/${nodeId}?access_token=${encodeURIComponent(token)}`, {
        method: 'DELETE',
      });
    } catch {
      /* ignore */
    }
  }

  // ────────────────────────────────────────────
  // HTTP helpers
  // ────────────────────────────────────────────

  private async httpGet<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw await this.parseError(res);
    return (await res.json()) as T;
  }

  private async httpPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.parseError(res);
    return (await res.json()) as T;
  }

  private async parseError(res: Response): Promise<MetaWriteError> {
    const text = await res.text();
    let fbCode: number | null = null;
    let msg = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as {
        error?: { code?: number; message?: string; error_user_msg?: string };
      };
      fbCode = parsed.error?.code ?? null;
      msg = parsed.error?.error_user_msg ?? parsed.error?.message ?? msg;
    } catch {
      /* body não-JSON */
    }
    return new MetaWriteError(res.status, fbCode, msg);
  }

  /** Converte MetaWriteError → BadRequest PT-BR pra UI. */
  private toHttpError(err: unknown): BadRequestException {
    if (err instanceof MetaWriteError) {
      return new BadRequestException(`Meta recusou (${err.status}): ${err.message}`);
    }
    return new BadRequestException(err instanceof Error ? err.message : String(err));
  }
}

// ────────────────────────────────────────────
// Mapeamentos objective → Meta
// ────────────────────────────────────────────

function mapObjective(obj: AdObjective): string {
  const map: Record<AdObjective, string> = {
    traffic: 'OUTCOME_TRAFFIC',
    conversions: 'OUTCOME_SALES',
    catalog_sales: 'OUTCOME_SALES',
    engagement: 'OUTCOME_ENGAGEMENT',
    awareness: 'OUTCOME_AWARENESS',
    leads: 'OUTCOME_LEADS',
  };
  return map[obj] ?? 'OUTCOME_TRAFFIC';
}

/**
 * Optimization goal SEGURO pra Onda 1 — nada que exija promoted_object
 * (pixel/catálogo/form), que só chegam nas Ondas 2/3. Conversions/leads/
 * catalog caem em LINK_CLICKS por ora (a campanha publica e roda; a
 * otimização avançada vem depois sem quebrar nada).
 */
function mapOptimizationGoal(obj: AdObjective): string {
  const map: Record<AdObjective, string> = {
    traffic: 'LINK_CLICKS',
    conversions: 'LINK_CLICKS',
    catalog_sales: 'LINK_CLICKS',
    engagement: 'POST_ENGAGEMENT',
    awareness: 'REACH',
    leads: 'LINK_CLICKS',
  };
  return map[obj] ?? 'LINK_CLICKS';
}

/**
 * Normaliza o targeting pros requisitos atuais do Meta:
 *  - geo_locations mínimo (Brasil) se vier vazio;
 *  - targeting_automation.advantage_audience explícito (0/1) — o Meta passou
 *    a EXIGIR a flag de público Advantage. 0 = respeita o público definido
 *    (não expande automaticamente). Só seta se o caller não definiu.
 */
function normalizeTargeting(t: Record<string, unknown>): Record<string, unknown> {
  const targeting = { ...(t ?? {}) };
  if (!targeting.geo_locations) {
    targeting.geo_locations = { countries: ['BR'] };
  }
  if (targeting.targeting_automation === undefined) {
    targeting.targeting_automation = { advantage_audience: 0 };
  }
  return targeting;
}
