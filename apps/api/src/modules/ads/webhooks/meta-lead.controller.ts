import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { AdLeadsService, MetaLeadPayload } from './ad-leads.service';

/**
 * Webhook do Meta Lead Ads (Bloco F).
 *
 * Setup no Meta Developers:
 *   1. App Settings > Webhooks > Page > Subscribe to "leadgen"
 *   2. Callback URL: https://active.eclick.app.br/webhooks/meta/lead-ads
 *   3. Verify Token: valor do META_WEBHOOK_VERIFY_TOKEN do .env
 *
 * Fluxo:
 *   - Meta faz GET com hub.challenge pra validar o endpoint (uma vez)
 *   - Cada lead novo vira POST com payload contendo entry[].changes[]
 *   - Validamos X-Hub-Signature-256 com META_APP_SECRET
 *   - Resolvemos org_id via page_id → ad_integrations.metadata.page_ids
 *
 * Segurança:
 *   - Endpoint PÚBLICO (Meta não tem JWT)
 *   - HMAC-SHA256 do raw body (NÃO do JSON.stringify) verifica autenticidade
 *   - hmac_verified=false ainda processa (defesa em profundidade) mas
 *     persiste flag pra audit + alerta nos logs
 */
@Controller('webhooks/meta/lead-ads')
export class MetaLeadAdsController {
  private readonly logger = new Logger(MetaLeadAdsController.name);

  constructor(
    private readonly leads: AdLeadsService,
    private readonly supabase: SupabaseService,
  ) {}

  // ────────────────────────────────────────────
  // GET — verificação inicial do Meta
  // ────────────────────────────────────────────

  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): string {
    const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (!expected) {
      this.logger.error('META_WEBHOOK_VERIFY_TOKEN não configurado');
      throw new BadRequestException('verify token not configured');
    }
    if (mode !== 'subscribe' || token !== expected) {
      this.logger.warn(`webhook verify falhou: mode=${mode} tokenMatch=${token === expected}`);
      throw new BadRequestException('verify failed');
    }
    if (!challenge) {
      throw new BadRequestException('missing hub.challenge');
    }
    this.logger.log(`webhook verify ok`);
    return challenge;
  }

  // ────────────────────────────────────────────
  // POST — recebe leads
  // ────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: WebhookEntry,
  ): Promise<{ ok: true; processed: number }> {
    const hmacVerified = this.verifySignature(req.rawBody, signature);
    if (!hmacVerified) {
      this.logger.warn(
        `[meta-lead] HMAC inválido — processando mesmo assim (audit: hmac_verified=false)`,
      );
    }

    if (body?.object !== 'page') {
      // Outros tipos (instagram, etc) não suportados ainda — responde 200
      // pra Meta não retentar infinitamente
      return { ok: true, processed: 0 };
    }

    let processed = 0;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'leadgen') continue;
        const value = change.value as MetaLeadgenValue | undefined;
        if (!value?.leadgen_id) continue;

        try {
          const orgId = await this.resolveOrgFromPage(value.page_id ?? entry.id);
          if (!orgId) {
            this.logger.warn(
              `[meta-lead] page_id=${value.page_id ?? entry.id} sem org_id mapeado — ignorando`,
            );
            continue;
          }

          // Resolve integration_id (qualquer integração da org com platform=meta)
          const integrationId = await this.resolveIntegration(orgId);
          if (!integrationId) {
            this.logger.warn(`[meta-lead] org=${orgId} sem ad_integration meta — ignorando`);
            continue;
          }

          // Meta envia só leadgen_id; pra extrair field_data precisaria
          // expandir via Graph API GET /<leadgen_id>?access_token=...
          // Pra MVP, processamos com o que veio no payload (Meta pode incluir
          // field_data quando configurado em "advanced settings"). Quando
          // não vem, salvamos com phone=null e marketing complementa manual.
          const payload: MetaLeadPayload = {
            leadgen_id: value.leadgen_id,
            ad_id: value.ad_id,
            form_id: value.form_id,
            page_id: value.page_id,
            field_data: value.field_data ?? [],
            campaign_id: value.campaign_id,
            campaign_name: value.campaign_name,
            created_time: value.created_time,
          };
          await this.leads.processMetaLead({
            orgId,
            integrationId,
            payload,
            hmacVerified,
          });
          processed += 1;
        } catch (err) {
          this.logger.error(
            `[meta-lead] processamento falhou leadgen_id=${value.leadgen_id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    return { ok: true, processed };
  }

  // ────────────────────────────────────────────
  // HMAC validation
  // ────────────────────────────────────────────

  private verifySignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    if (!rawBody || !signature) return false;
    const secret = process.env.META_APP_SECRET;
    if (!secret) {
      this.logger.error('META_APP_SECRET ausente — pulando HMAC check');
      return false;
    }
    const match = /^sha256=([a-f0-9]+)$/i.exec(signature);
    if (!match) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const provided = match[1] ?? '';
    if (expected.length !== provided.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
    } catch {
      return false;
    }
  }

  // ────────────────────────────────────────────
  // Org/integration resolution
  // ────────────────────────────────────────────

  /**
   * Mapeia page_id → org_id via ad_integrations.metadata.page_ids[].
   * Quando uma org conecta o Meta, populamos page_ids[] no metadata
   * (TODO no Bloco B de OAuth — adicionar fetch /me/accounts).
   * Pra MVP, usamos fallback: se há 1 só org com integração meta ativa,
   * usa essa.
   */
  private async resolveOrgFromPage(pageId: string | undefined): Promise<string | null> {
    if (pageId) {
      const { data } = await this.supabase.adminClient
        .from('ad_integrations')
        .select('org_id, metadata')
        .eq('platform', 'meta')
        .eq('status', 'active');
      const match = ((data ?? []) as Array<{ org_id: string; metadata: Record<string, unknown> }>)
        .find((r) => {
          const pageIds = r.metadata?.page_ids as string[] | undefined;
          return Array.isArray(pageIds) && pageIds.includes(pageId);
        });
      if (match) return match.org_id;
    }

    // Fallback: única org com integration ativa
    const { data: all } = await this.supabase.adminClient
      .from('ad_integrations')
      .select('org_id')
      .eq('platform', 'meta')
      .eq('status', 'active');
    const orgs = Array.from(
      new Set(((all ?? []) as Array<{ org_id: string }>).map((r) => r.org_id)),
    );
    if (orgs.length === 1) return orgs[0]!;
    return null;
  }

  private async resolveIntegration(orgId: string): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('ad_integrations')
      .select('id')
      .eq('org_id', orgId)
      .eq('platform', 'meta')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1);
    return ((data ?? [])[0] as { id: string } | undefined)?.id ?? null;
  }
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface WebhookEntry {
  object: string;
  entry?: Array<{
    id: string;
    time?: number;
    changes?: Array<{
      field: string;
      value: unknown;
    }>;
  }>;
}

interface MetaLeadgenValue {
  leadgen_id: string;
  ad_id?: string;
  form_id?: string;
  page_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  field_data?: Array<{ name: string; values: string[] }>;
  created_time?: string;
}
