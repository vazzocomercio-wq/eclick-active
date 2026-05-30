import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { ClippingRunnerService } from './clipping-runner.service';

/**
 * Webhook de conclusão de corte (chamado pelo provedor externo, ex: Vizard).
 * SEM AuthGuard — autenticação é por correlação de clipping_job_id + estado.
 * Idempotente: handleResult só age se o job ainda está em 'clipping'.
 * Sempre responde 200 pra o provedor não ficar re-tentando.
 */
@Controller('webhooks/clipping')
export class ClippingWebhookController {
  private readonly log = new Logger(ClippingWebhookController.name);

  constructor(private readonly clipping: ClippingRunnerService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@Body() payload: unknown): Promise<{ ok: boolean; reason?: string }> {
    try {
      const parsed = this.clipping.parseWebhook(payload);
      if (!parsed) return { ok: false, reason: 'unparseable' };
      const r = await this.clipping.handleResult(parsed);
      return { ok: r.acted, reason: r.reason };
    } catch (err) {
      this.log.error(`[webhook/clipping] erro (respondendo 200): ${String(err)}`);
      return { ok: false, reason: 'error' };
    }
  }
}
