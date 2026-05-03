import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { TikTokWebhookService } from './tiktok-webhook.service';
import type { TikTokWebhookBody } from '../../../common/channels/providers/tiktok/tiktok.types';

/**
 * Webhook do TikTok.
 *
 * GET  /webhooks/tiktok → verificação (TikTok envia challenge similar Meta)
 * POST /webhooks/tiktok → eventos
 *
 * TikTok assina webhooks com HMAC SHA-256 do raw body usando o
 * webhook secret. Header: X-Tiktok-Signature.
 *
 * Sempre retorna 200 OK — TikTok desabilita o webhook se receber 5xx
 * repetidamente.
 */
@Controller('webhooks/tiktok')
export class TikTokWebhookController {
  private readonly logger = new Logger(TikTokWebhookController.name);

  constructor(private readonly service: TikTokWebhookService) {}

  /** Challenge de verificação. */
  @Get()
  verify(
    @Query('challenge') challenge: string | undefined,
    @Query('verify_token') token: string | undefined,
  ): string {
    const expected = process.env.TIKTOK_WEBHOOK_VERIFY_TOKEN ?? 'eclick-active-tt-verify';
    if (token === expected && challenge) {
      return challenge;
    }
    this.logger.warn('TikTok webhook verify rejeitado');
    throw new ForbiddenException('Invalid verify token');
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Body() body: TikTokWebhookBody,
    @Headers('x-tiktok-signature') signature: string | undefined,
  ): Promise<{ ok: boolean; reason?: string }> {
    // Valida HMAC se secret configurado
    const secret = process.env.TIKTOK_WEBHOOK_SECRET;
    if (secret && signature) {
      const computed = createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
      // timing-safe compare
      let mismatch = computed.length !== signature.length ? 1 : 0;
      for (let i = 0; i < computed.length; i++) {
        mismatch |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
      }
      if (mismatch !== 0) {
        this.logger.warn('TikTok signature inválida');
        return { ok: true, reason: 'invalid_signature' };
      }
    } else if (!secret) {
      this.logger.warn('TIKTOK_WEBHOOK_SECRET ausente — pulando validação (DEV ONLY)');
    }

    try {
      const result = await this.service.handle(body);
      return { ok: result.accepted, reason: result.reason };
    } catch (err) {
      this.logger.error(
        `TikTok webhook falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false, reason: 'handler_error' };
    }
  }
}
