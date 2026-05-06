import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AutomationBridgeService } from './automation-bridge.service';
import { AutomationBridgeGuard } from './automation-bridge.guard';
import type {
  NotifyLojistaInput,
  NotifyLojistaResult,
  TriggerCartRecoveryInput,
  TriggerCartRecoveryResult,
} from './automation-bridge.types';

/**
 * Endpoints server-to-server chamados pelo motor StoreAutomationEngine
 * do SaaS. Auth via shared secret no header X-Automation-Bridge-Token
 * — NÃO usa SupabaseAuthGuard (não tem JWT de user).
 *
 * Padrão Active: webhooks/bridges públicos omitem `@UseGuards(AuthGuard)`
 * — só usam guards customizados (aqui: AutomationBridgeGuard).
 */
@UseGuards(AutomationBridgeGuard)
@Controller('commerce/automation-bridge')
export class AutomationBridgeController {
  constructor(private readonly service: AutomationBridgeService) {}

  /**
   * POST /commerce/automation-bridge/notify-lojista
   *
   * Envia mensagem WhatsApp pro lojista (owner do org). Severidade
   * determina se é envio imediato ou agrupado em digest.
   *
   * Body:
   *   organization_id: string
   *   message: string                              (texto pronto, IA do SaaS já formatou)
   *   severity: critical|high|medium|low|opportunity
   *   action_id?: string                           (FK lógica → public.store_automation_actions)
   *   deeplink?: string                            (URL pra abrir no SaaS)
   */
  @Post('notify-lojista')
  @HttpCode(HttpStatus.OK)
  notify(
    @Body() body: NotifyLojistaInput,
  ): Promise<NotifyLojistaResult> {
    return this.service.notifyLojista(body);
  }

  /**
   * POST /commerce/automation-bridge/trigger-cart-recovery
   *
   * Dispara mensagens de recovery em N carrinhos abandonados — alvos
   * específicos via `cart_ids` ou via segmento temporal.
   *
   * Body:
   *   organization_id: string
   *   cart_ids?: string[]                          (alvos específicos)
   *   segment?: abandoned_24h|abandoned_48h|abandoned_7d
   *   template_key?: string                        (override default)
   *   custom_message?: string                      (override final)
   *   rate_limit_ms?: number                       (default 3000)
   *   action_id?: string
   *
   * Retorna count: { ok, dispatched, skipped, errors, execution_ids }
   */
  @Post('trigger-cart-recovery')
  @HttpCode(HttpStatus.OK)
  triggerCartRecovery(
    @Body() body: TriggerCartRecoveryInput,
  ): Promise<TriggerCartRecoveryResult> {
    return this.service.triggerCartRecovery(body);
  }
}
