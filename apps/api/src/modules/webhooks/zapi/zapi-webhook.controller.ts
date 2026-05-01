import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { ZapiInboundPayload } from '../../../common/channels/providers/zapi/zapi.types';
import { ZapiWebhookPayloadDto } from './zapi-webhook.dto';
import { ZapiWebhookService } from './zapi-webhook.service';

/**
 * Webhook da Z-API. **Não** está atrás do AuthGuard — Z-API não envia
 * Bearer token nem signature. A "autenticação" é feita pelo
 * `instanceId` que vem no payload e é validado contra a base de canais
 * ativos (`ZapiWebhookService.handle`).
 *
 * Pra Z-API esse endpoint é configurado em
 * `channels.credentials.webhookUrl = 'https://api.eclick.app.br/webhooks/zapi'`.
 *
 * Sempre responde 200 — payloads desconhecidos / inválidos não devem
 * fazer Z-API entrar em loop de retry. Em caso de erro de
 * processamento, logamos e retornamos `{ ok: false, reason }`.
 */
@Controller('webhooks/zapi')
@UsePipes(
  // Override do ValidationPipe global (que tem whitelist=true). Aqui
  // queremos receber TODOS os campos do payload da Z-API; o DTO só
  // valida os obrigatórios.
  new ValidationPipe({
    whitelist: false,
    forbidNonWhitelisted: false,
    transform: false,
  }),
)
export class ZapiWebhookController {
  private readonly logger = new Logger(ZapiWebhookController.name);

  constructor(private readonly service: ZapiWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Body() payload: ZapiWebhookPayloadDto,
  ): Promise<{ ok: boolean; reason?: string }> {
    try {
      const result = await this.service.handle(payload as unknown as ZapiInboundPayload);
      return { ok: result.accepted, ...(result.reason ? { reason: result.reason } : {}) };
    } catch (err) {
      this.logger.error(
        `webhook failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Mesmo em erro retornamos 200 — Z-API faz retry agressivo em 5xx.
      return { ok: false, reason: 'internal_error' };
    }
  }
}
