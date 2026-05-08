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
  CreateCampaignCardInput,
  CreateCampaignCardResult,
  NotifyLojistaInput,
  NotifyLojistaResult,
  SendBroadcastInput,
  SendBroadcastResult,
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

  /**
   * POST /commerce/automation-bridge/send-broadcast
   *
   * Dispara WhatsApp Broadcast pra audiência segmentada — chamado pelo
   * módulo Conteúdo Social do SaaS (Onda 3 / S1) quando lojista clica
   * "Publicar agora" numa peça `whatsapp_broadcast`.
   *
   * Body:
   *   organization_id: string
   *   message: string                                          (texto pronto)
   *   target_segment: todos|compradores|interessados|inativos
   *   include_image?: boolean
   *   image_url?: string                                       (se include_image)
   *   include_link?: boolean
   *   link_url?: string                                        (se include_link)
   *   source_content_id?: string                               (social_content.id)
   *   rate_limit_ms?: number                                   (default 3000, min 1000)
   *   force_large_audience?: boolean                           (default false; necessário pra >1000)
   *
   * Retorna { ok, dispatched, skipped, errors, audience_size, execution_ids }
   */
  @Post('send-broadcast')
  @HttpCode(HttpStatus.OK)
  sendBroadcast(
    @Body() body: SendBroadcastInput,
  ): Promise<SendBroadcastResult> {
    return this.service.sendBroadcast(body);
  }

  /**
   * POST /commerce/automation-bridge/create-campaign-card
   *
   * M4 (2026-05-08) — chamado pelo Campaign Center IA do SaaS quando um
   * alerta de deadline dispara OU quando uma recomendação cai em
   * pending_manager_approval. Cria 1 deal no funil + 1 task vinculada.
   *
   * Idempotência via dedup_key (custom_fields.dedup_key). Se ja existe
   * deal com mesma key, reusa (não cria duplicado).
   *
   * Body:
   *   organization_id: string
   *   pipeline_id: string                          (uuid do funil)
   *   stage_id: string                             (uuid do estágio inicial)
   *   assigned_to: string                          (uuid do user dono do card+task)
   *   title: string                                (título do card)
   *   task_title: string                           (texto da task)
   *   due_date?: string                            (ISO 8601)
   *   value?: number                               (BRL)
   *   tags?: string[]
   *   metadata?: Record<string, unknown>
   *   dedup_key?: string                           (chave lógica pra dedup)
   *
   * Retorna { ok, deal_id, task_id, created }
   */
  @Post('create-campaign-card')
  @HttpCode(HttpStatus.OK)
  createCampaignCard(
    @Body() body: CreateCampaignCardInput,
  ): Promise<CreateCampaignCardResult> {
    return this.service.createCampaignCard(body);
  }
}
