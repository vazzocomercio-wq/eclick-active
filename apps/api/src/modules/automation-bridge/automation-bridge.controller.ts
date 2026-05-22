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
  CreateLeadInput,
  CreateLeadResult,
  EnsureServicePipelineInput,
  EnsureServicePipelineResult,
  MoveCardInput,
  MoveCardResult,
  NotifyLojistaInput,
  NotifyLojistaResult,
  SendBroadcastInput,
  SendBroadcastResult,
  SendDirectInput,
  SendDirectResult,
  TriggerCartRecoveryInput,
  TriggerCartRecoveryResult,
  UpsertContactInput,
  UpsertContactResult,
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
   * POST /commerce/automation-bridge/send-direct
   *
   * Mensagem WhatsApp 1-a-1 transacional. Usado pelas notificações da
   * Loja Própria do SaaS: pedido pago/enviado/entregue, promoção de tier.
   *
   * Cria/recupera contato pelo telefone + dispatch via canal WhatsApp
   * ativo da org. Idempotente via `dedup_key` (consulta
   * automation_executions com mesmo target_ref + execution_type).
   *
   * Body:
   *   organization_id: string
   *   phone: string                                (sanitizado pra digits)
   *   message: string                              (texto pronto, pode ter *bold*)
   *   dedup_key?: string                           ("storefront_order:abc:shipped")
   *
   * Retorna { ok, sent, skipped?, reason?, execution_id }
   */
  @Post('send-direct')
  @HttpCode(HttpStatus.OK)
  sendDirect(@Body() body: SendDirectInput): Promise<SendDirectResult> {
    return this.service.sendDirect(body);
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

  /**
   * POST /commerce/automation-bridge/create-lead
   *
   * Formulário editável da Loja Própria → cria/atualiza contato (por
   * phone/email) + deal no funil+etapa escolhidos, vinculados. Se
   * assigned_to ausente, resolve o dono da org. Idempotente por dedup_key.
   *
   * Body: CreateLeadInput. Retorna { ok, deal_id, contact_id, assigned_to, created }.
   */
  @Post('create-lead')
  @HttpCode(HttpStatus.OK)
  createLead(@Body() body: CreateLeadInput): Promise<CreateLeadResult> {
    return this.service.createLead(body);
  }

  /**
   * POST /commerce/automation-bridge/upsert-contact
   *
   * Cria/acha um contato (por phone, senão email) SEM abrir card. Usado
   * pelo Ambientador IA da Loja Própria: ao validar o WhatsApp do cliente,
   * o SaaS registra o contato no Active e guarda o contact_id. O card só
   * é aberto depois, quando o cliente gera as imagens (create-campaign-card).
   *
   * Body: UpsertContactInput. Retorna { ok, contact_id, created }.
   */
  @Post('upsert-contact')
  @HttpCode(HttpStatus.OK)
  upsertContact(@Body() body: UpsertContactInput): Promise<UpsertContactResult> {
    return this.service.upsertContact(body);
  }

  /**
   * POST /commerce/automation-bridge/ensure-service-pipeline
   *
   * Garante (idempotente) um funil dedicado de atendimento pra org, com
   * etapas padrão. Usado pelo Ambientador IA da Loja Própria pra ter o
   * funil "Atendimento da Loja" antes de abrir o card do cliente.
   *
   * Body: EnsureServicePipelineInput. Retorna ids do funil + etapa de entrada.
   */
  @Post('ensure-service-pipeline')
  @HttpCode(HttpStatus.OK)
  ensureServicePipeline(
    @Body() body: EnsureServicePipelineInput,
  ): Promise<EnsureServicePipelineResult> {
    return this.service.ensureServicePipeline(body);
  }

  /**
   * POST /commerce/automation-bridge/move-card
   *
   * Avança um card existente de etapa. Usado pela automação do funil
   * "Anúncios ML": publicação → Incluir Campanha, anúncio em campanha →
   * Incluir ADS, ADS resolvido → Concluído. Avança só pra frente.
   * Atualiza o `action_link` (botão do card).
   *
   * Acha o card por `deal_id` direto OU por `organization_id` + `dedup_key`.
   *
   * Body:
   *   deal_id?: string                             (id do deal — deriva a org) — OU
   *   organization_id?: string  +  dedup_key?: string  (custom_fields.dedup_key)
   *   to_stage_id?: string                         (uuid da etapa) — OU
   *   to_stage_name?: string                       (nome, resolvido no funil)
   *   action_link?: { label, url } | null          (botão do card; null limpa)
   *
   * Retorna { ok, found, deal_id, moved, reason? }
   */
  @Post('move-card')
  @HttpCode(HttpStatus.OK)
  moveCard(@Body() body: MoveCardInput): Promise<MoveCardResult> {
    return this.service.moveCard(body);
  }
}
