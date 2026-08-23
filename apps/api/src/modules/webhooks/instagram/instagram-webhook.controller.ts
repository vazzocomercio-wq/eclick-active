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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { InstagramWebhookService } from './instagram-webhook.service';
import type { InstagramWebhookBody } from '../../../common/channels/providers/instagram/instagram.types';

/**
 * Webhook do Instagram via Messenger Platform.
 *
 * GET  /webhooks/instagram → verificação inicial (Meta envia challenge)
 * POST /webhooks/instagram → eventos (DMs, delivery, read)
 *
 * Sem AuthGuard. Validação:
 *   - GET: hub.verify_token == INSTAGRAM_WEBHOOK_VERIFY_TOKEN
 *   - POST: HMAC SHA-256 do raw body com META_APP_SECRET no header
 *           X-Hub-Signature-256
 *
 * Sempre retorna 200 OK (até em caso de erro interno) — Meta tem retry
 * exponencial agressivo e marca o app como "broken" se receber 5xx
 * repetidamente.
 */
@Controller('webhooks/instagram')
export class InstagramWebhookController {
  private readonly logger = new Logger(InstagramWebhookController.name);

  constructor(private readonly service: InstagramWebhookService) {}

  /**
   * GET — Meta envia ?hub.mode=subscribe&hub.challenge=XXX&hub.verify_token=YYY.
   * Devemos retornar `XXX` (number) se o token bate. Caso contrário 403.
   */
  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): number {
    // Sem default hardcoded: o valor antigo ('eclick-active-ig-verify')
    // estava no código-fonte e a env nunca foi configurada, então
    // qualquer um que lesse o repo conseguia completar a verificação
    // apontando a própria assinatura de webhook pra este endpoint.
    const expected = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
    if (!expected) {
      this.logger.error(
        'INSTAGRAM_WEBHOOK_VERIFY_TOKEN ausente — rejeitando verificação. ' +
        'Configure a env no Railway (service api) com o mesmo valor do painel da Meta.',
      );
      throw new ForbiddenException('Webhook verify token not configured');
    }
    if (mode === 'subscribe' && token === expected && challenge) {
      const n = Number(challenge);
      if (Number.isFinite(n)) return n;
    }
    this.logger.warn(`Webhook verify rejeitado (token mismatch ou mode inválido)`);
    throw new ForbiddenException('Invalid verify token');
  }

  /**
   * POST — eventos. Validamos signature antes de processar. Sempre 200.
   *
   * O HMAC tem que ser calculado sobre os BYTES originais. O `main.ts` sobe
   * o Nest com `rawBody: true`, que expõe `req.rawBody` como **Buffer** —
   * o tipo antigo dizia `string`, e o fallback `JSON.stringify(body)`
   * reserializava o objeto já parseado: qualquer diferença de espaçamento,
   * escape unicode ou ordem de chaves produz um hash diferente e a
   * assinatura legítima da Meta seria rejeitada. Sem raw body não dá pra
   * verificar nada, então rejeitamos em vez de fingir que validamos.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Body() body: InstagramWebhookBody,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() req: Request,
  ): Promise<{ ok: boolean; reason?: string }> {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      this.logger.error('rawBody ausente — impossível validar HMAC. Confira rawBody:true no main.ts');
      return { ok: true, reason: 'no_raw_body' };
    }

    const valid = this.service.verifySignature(rawBody, signature);
    if (!valid) {
      this.logger.warn('Webhook signature inválida — ignorando');
      return { ok: true, reason: 'invalid_signature' };
    }

    try {
      const result = await this.service.handle(body);
      return { ok: result.accepted, reason: result.reason };
    } catch (err) {
      // Nunca propaga erro pro Meta — sempre 200
      this.logger.error(
        `Webhook handler falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false, reason: 'handler_error' };
    }
  }
}
