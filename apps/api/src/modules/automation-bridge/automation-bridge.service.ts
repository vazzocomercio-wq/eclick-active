import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../common/channels/channel-dispatcher.service';
import { DealsService } from '../deals/deals.service';
import { TasksService } from '../tasks/tasks.service';
import { ContactsService } from '../contacts/contacts.service';
import type {
  AutomationExecutionRow,
  AutomationSeverity,
  BroadcastSegment,
  CartSegment,
  CreateCampaignCardInput,
  CreateCampaignCardResult,
  CreateLeadInput,
  CreateLeadResult,
  EnsureServicePipelineInput,
  EnsureServicePipelineResult,
  ExecutionType,
  MoveCardInput,
  MoveCardResult,
  NotifyLojistaInput,
  NotifyLojistaResult,
  OrgAutomationBridgeSettings,
  SendBroadcastInput,
  SendBroadcastResult,
  SendDirectInput,
  SendDirectResult,
  TriggerCartRecoveryInput,
  TriggerCartRecoveryResult,
  UpsertContactInput,
  UpsertContactResult,
} from './automation-bridge.types';

// Severidades que disparam mensagem imediata (sem digest)
const IMMEDIATE_SEVERITIES = new Set<AutomationSeverity>(['critical', 'high']);

const SEVERITY_LABEL: Record<AutomationSeverity, string> = {
  critical: '🚨 Crítico',
  high: '⚠️ Alto',
  medium: '🔔 Médio',
  low: 'ℹ️ Baixo',
  opportunity: '💡 Oportunidade',
};

const SEGMENT_THRESHOLDS_HOURS: Record<CartSegment, [number, number]> = {
  // [min_hours_ago, max_hours_ago] — janela do bucket
  abandoned_24h: [24, 48],
  abandoned_48h: [48, 72],
  abandoned_7d: [72, 168],
};

const DEFAULT_RATE_LIMIT_MS = 3000;
const MAX_CART_BATCH = 500;

// Broadcast safety knobs
const BROADCAST_MIN_RATE_MS = 1000;
const BROADCAST_LARGE_AUDIENCE = 1000;
const BROADCAST_TODOS_WARN = 500;
const BROADCAST_HARD_LIMIT = 10_000;
const BROADCAST_PLACEHOLDER = '[LINK DO PRODUTO]';

// Pedido "concretizado" no Active = whatsapp_orders já avançado de pending/cancelled
const BUYER_ORDER_STATUSES = ['confirmed', 'processing', 'shipped', 'delivered'];

interface AudienceContact {
  id: string;
  phone: string | null;
  channel_profiles: Record<string, unknown> | null;
}

/**
 * Service do Automation Bridge — recebe chamadas do SaaS e executa via
 * infraestrutura WhatsApp/cart do Active.
 *
 * Multi-tenant: TODA query filtra por `org_id`. RLS é segunda camada.
 *
 * Reúso:
 *   - ChannelDispatcherService: envio real via Z-API/Baileys
 *   - active.organizations.settings.automation_bridge.owner_contact_id:
 *     contato configurado pelo lojista que representa ele mesmo (recebe
 *     notificações). Sem migration nova.
 *
 * Falha graciosa: se owner_contact_id não estiver configurado, retorna
 * `sent: false` com motivo no `result.error`. NÃO levanta exception
 * (SaaS recebe 200 + ok: true mas com queued=false e sent=false).
 */
@Injectable()
export class AutomationBridgeService {
  private readonly log = new Logger(AutomationBridgeService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly deals: DealsService,
    private readonly tasks: TasksService,
    private readonly contacts: ContactsService,
  ) {}

  // ────────────────────────────────────────────
  // 1) Notify Lojista
  // ────────────────────────────────────────────

  async notifyLojista(input: NotifyLojistaInput): Promise<NotifyLojistaResult> {
    input = { ...input, organization_id: await this.resolveActiveOrgId(input.organization_id) };
    const exec = await this.insertExecution({
      org_id: input.organization_id,
      execution_type: 'whatsapp_notify_lojista',
      severity: input.severity,
      source_action_id: input.action_id ?? null,
      target_ref: null,
      payload: {
        message: input.message,
        deeplink: input.deeplink ?? null,
      },
    });

    // Imediato pra critical/high
    if (IMMEDIATE_SEVERITIES.has(input.severity)) {
      const sent = await this.deliverNotifyLojista(exec.id, input);
      return {
        ok: true,
        sent,
        queued_for_digest: false,
        execution_id: exec.id,
      };
    }

    // Digest pra medium/low/opportunity (worker processa depois)
    return {
      ok: true,
      sent: false,
      queued_for_digest: true,
      execution_id: exec.id,
    };
  }

  /**
   * Envia 1 mensagem de notificação imediata pro lojista. Marca status
   * como 'sent' / 'failed' / 'skipped' conforme outcome.
   */
  private async deliverNotifyLojista(
    executionId: string,
    input: NotifyLojistaInput,
  ): Promise<boolean> {
    try {
      const target = await this.resolveOwnerTarget(input.organization_id);
      if (!target) {
        await this.markExecution(executionId, {
          status: 'skipped',
          error_message:
            'Lojista não configurou owner_contact_id em organizations.settings.automation_bridge',
        });
        return false;
      }

      const body = formatLojistaMessage(input);
      const result = await this.dispatcher.send({
        org_id: input.organization_id,
        channel_id: target.channel_id,
        contact_id: target.contact_id,
        content_type: 'text',
        content: { body },
      });

      await this.markExecution(executionId, {
        status: 'sent',
        result: {
          channel_message_id: result.channel_message_id,
          status: result.status,
        },
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`notify_lojista falhou exec=${executionId}: ${msg}`);
      await this.markExecution(executionId, {
        status: 'failed',
        error_message: msg.slice(0, 500),
      });
      return false;
    }
  }

  // ────────────────────────────────────────────
  // 2) Cart Recovery em massa
  // ────────────────────────────────────────────

  async triggerCartRecovery(
    input: TriggerCartRecoveryInput,
  ): Promise<TriggerCartRecoveryResult> {
    const orgId = await this.resolveActiveOrgId(input.organization_id);
    const rateLimit = Math.max(
      0,
      input.rate_limit_ms ?? DEFAULT_RATE_LIMIT_MS,
    );

    // Resolve lista de cart_ids alvo
    const cartIds = await this.resolveCartTargets(orgId, input);
    if (cartIds.length === 0) {
      return { ok: true, dispatched: 0, skipped: 0, errors: 0, execution_ids: [] };
    }

    // Insere todas as execuções como pending de uma vez (audit trail completo)
    const executionIds: string[] = [];
    for (const cartId of cartIds) {
      const exec = await this.insertExecution({
        org_id: orgId,
        execution_type: 'cart_recovery_send',
        severity: null,
        source_action_id: input.action_id ?? null,
        target_ref: cartId,
        payload: {
          template_key: input.template_key ?? 'cart_recovery_default',
          custom_message: input.custom_message ?? null,
          rate_limit_ms: rateLimit,
        },
      });
      executionIds.push(exec.id);
    }

    let dispatched = 0;
    let skipped = 0;
    let errors = 0;

    // Dispatch sequencial com rate limit
    for (let i = 0; i < cartIds.length; i++) {
      const cartId = cartIds[i]!;
      const execId = executionIds[i]!;

      const outcome = await this.deliverCartRecovery(orgId, execId, cartId, {
        templateKey: input.template_key,
        customMessage: input.custom_message,
      });
      if (outcome === 'sent') dispatched++;
      else if (outcome === 'skipped') skipped++;
      else errors++;

      // Rate limit entre mensagens (skip last iteration)
      if (rateLimit > 0 && i < cartIds.length - 1) {
        await sleep(rateLimit);
      }
    }

    return {
      ok: true,
      dispatched,
      skipped,
      errors,
      execution_ids: executionIds,
    };
  }

  private async deliverCartRecovery(
    orgId: string,
    executionId: string,
    cartId: string,
    args: {
      templateKey?: string;
      customMessage?: string;
    },
  ): Promise<'sent' | 'skipped' | 'failed'> {
    try {
      // Busca cart com snapshot do contato + total
      const { data: cart, error } = await this.supabase.adminClient
        .from('whatsapp_carts')
        .select(
          'id, org_id, contact_id, conversation_id, items, total, status',
        )
        .eq('id', cartId)
        .eq('org_id', orgId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!cart) {
        await this.markExecution(executionId, {
          status: 'skipped',
          error_message: 'Cart não encontrado ou pertence a outra org',
        });
        return 'skipped';
      }

      const cartRow = cart as {
        id: string;
        org_id: string;
        contact_id: string;
        conversation_id: string | null;
        items: Array<{ name: string; quantity: number }>;
        total: number;
        status: string;
      };

      // Skip se já convertido/cancelado
      if (cartRow.status === 'converted' || cartRow.status === 'cancelled') {
        await this.markExecution(executionId, {
          status: 'skipped',
          error_message: `Cart status=${cartRow.status} — não recupera`,
        });
        return 'skipped';
      }

      // Resolve channel WhatsApp do contato
      const channelId = await this.resolveContactWhatsAppChannel(
        orgId,
        cartRow.contact_id,
      );
      if (!channelId) {
        await this.markExecution(executionId, {
          status: 'skipped',
          error_message: 'Contato sem canal WhatsApp ativo',
        });
        return 'skipped';
      }

      const body = formatCartRecoveryMessage(cartRow, {
        templateKey: args.templateKey,
        customMessage: args.customMessage,
      });

      const result = await this.dispatcher.send({
        org_id: orgId,
        channel_id: channelId,
        contact_id: cartRow.contact_id,
        content_type: 'text',
        content: { body },
      });

      await this.markExecution(executionId, {
        status: 'sent',
        result: {
          channel_message_id: result.channel_message_id,
          status: result.status,
        },
      });
      return 'sent';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`cart_recovery falhou exec=${executionId}: ${msg}`);
      await this.markExecution(executionId, {
        status: 'failed',
        error_message: msg.slice(0, 500),
      });
      return 'failed';
    }
  }

  /** Resolve cart_ids alvo: explícitos OU via segment temporal. */
  private async resolveCartTargets(
    orgId: string,
    input: TriggerCartRecoveryInput,
  ): Promise<string[]> {
    if (input.cart_ids && input.cart_ids.length > 0) {
      // Valida que todos pertencem à org
      const { data } = await this.supabase.adminClient
        .from('whatsapp_carts')
        .select('id')
        .eq('org_id', orgId)
        .in('id', input.cart_ids.slice(0, MAX_CART_BATCH));
      return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    }

    if (input.segment) {
      const [minH, maxH] = SEGMENT_THRESHOLDS_HOURS[input.segment];
      const now = Date.now();
      const minDate = new Date(now - maxH * 3600_000).toISOString();
      const maxDate = new Date(now - minH * 3600_000).toISOString();

      const { data } = await this.supabase.adminClient
        .from('whatsapp_carts')
        .select('id')
        .eq('org_id', orgId)
        .eq('status', 'abandoned')
        .gte('last_interaction_at', minDate)
        .lte('last_interaction_at', maxDate)
        .limit(MAX_CART_BATCH);
      return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    }

    throw new BadRequestException('Informe cart_ids ou segment');
  }

  // ────────────────────────────────────────────
  // Owner contact resolution
  // ────────────────────────────────────────────

  /**
   * Resolve o contato + canal WhatsApp do lojista pra notificações.
   * Lê de `organizations.settings.automation_bridge.owner_contact_id`.
   */
  private async resolveOwnerTarget(
    orgId: string,
  ): Promise<{ contact_id: string; channel_id: string } | null> {
    const { data: org } = await this.supabase.adminClient
      .from('organizations')
      .select('settings')
      .eq('id', orgId)
      .maybeSingle();

    const settings = (org as { settings?: Record<string, unknown> } | null)
      ?.settings;
    if (!settings) return null;

    const bridge = (settings.automation_bridge ?? null) as
      | OrgAutomationBridgeSettings
      | null;
    const contactId = bridge?.owner_contact_id;
    if (!contactId) return null;

    // Resolve channel: explicit override ou primeiro WA ativo
    const channelId =
      bridge?.owner_channel_id ?? (await this.resolvePrimaryWhatsAppChannel(orgId));
    if (!channelId) return null;

    return { contact_id: contactId, channel_id: channelId };
  }

  private async resolvePrimaryWhatsAppChannel(
    orgId: string,
  ): Promise<string | null> {
    // Active suporta múltiplas variantes WA — `whatsapp` (Z-API),
    // `whatsapp_free` (Baileys). Coluna real é `status='active'`,
    // não `is_active`.
    const { data } = await this.supabase.adminClient
      .from('channels')
      .select('id')
      .eq('org_id', orgId)
      .in('channel_type', ['whatsapp', 'whatsapp_free'])
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  /**
   * Resolve um channel WhatsApp pra um contato específico — prioridade:
   * 1. Última conversa WA do contato
   * 2. Primeiro canal WA ativo da org (fallback)
   */
  private async resolveContactWhatsAppChannel(
    orgId: string,
    contactId: string,
  ): Promise<string | null> {
    const { data: convs } = await this.supabase.adminClient
      .from('conversations')
      .select('channel_id, channels:channel_id(channel_type)')
      .eq('org_id', orgId)
      .eq('contact_id', contactId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(5);

    type ConvRow = {
      channel_id: string;
      channels:
        | Array<{ channel_type: string }>
        | { channel_type: string }
        | null;
    };
    const found = ((convs ?? []) as unknown as ConvRow[]).find((c) => {
      const ch = Array.isArray(c.channels) ? c.channels[0] : c.channels;
      return ch?.channel_type === 'whatsapp' || ch?.channel_type === 'whatsapp_free';
    });
    if (found) return found.channel_id;

    return this.resolvePrimaryWhatsAppChannel(orgId);
  }

  // ────────────────────────────────────────────
  // SaaS org_id → Active org_id
  // ────────────────────────────────────────────

  // Cache do mapeamento (TTL curto; fallback = o próprio id)
  private readonly orgMapCache = new Map<string, { value: string; until: number }>();

  /**
   * O SaaS chama o bridge com o organization_id DELE (`public.organizations`).
   * As tabelas nativas do Active (channels, contacts, deals, pipelines,
   * org_members, whatsapp_carts…) são chaveadas pelo id de
   * `active.organizations`. Traduz SaaS→Active via
   * `active.organizations.saas_org_id`. Sem mapeamento → devolve o próprio id
   * (compat com chamador que já manda o id do Active / single-tenant).
   *
   * Aplicado no topo de TODA entrada pública: assim o `org_id` gravado no
   * audit (`automation_executions`) também fica como o id do Active, o que
   * mantém o digest worker (`resolveOwnerTarget(row.org_id)`) e a RLS de
   * leitura do lojista funcionando.
   */
  private async resolveActiveOrgId(incomingOrgId: string): Promise<string> {
    if (!incomingOrgId) return incomingOrgId;
    const cached = this.orgMapCache.get(incomingOrgId);
    if (cached && cached.until > Date.now()) return cached.value;

    let value = incomingOrgId;
    try {
      const { data } = await this.supabase.adminClient
        .from('organizations')
        .select('id')
        .eq('saas_org_id', incomingOrgId)
        .limit(1)
        .maybeSingle();
      const mapped = (data as { id: string } | null)?.id;
      if (mapped) value = mapped;
    } catch (err) {
      this.log.warn(`resolveActiveOrgId falhou para ${incomingOrgId}: ${String(err)}`);
    }
    this.orgMapCache.set(incomingOrgId, { value, until: Date.now() + 5 * 60 * 1000 });
    return value;
  }

  // ────────────────────────────────────────────
  // Persistence helpers
  // ────────────────────────────────────────────

  private async insertExecution(args: {
    org_id: string;
    execution_type: ExecutionType;
    severity: AutomationSeverity | null;
    source_action_id: string | null;
    target_ref: string | null;
    payload: Record<string, unknown>;
  }): Promise<AutomationExecutionRow> {
    const { data, error } = await this.supabase.adminClient
      .from('automation_executions')
      .insert({
        org_id: args.org_id,
        execution_type: args.execution_type,
        severity: args.severity,
        source_action_id: args.source_action_id,
        target_ref: args.target_ref,
        payload: args.payload,
        status: 'pending' as const,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(
        error?.message ?? 'Falha ao criar execution',
      );
    }
    return data as AutomationExecutionRow;
  }

  async markExecution(
    id: string,
    args: {
      status: 'sent' | 'failed' | 'skipped';
      result?: Record<string, unknown>;
      error_message?: string;
      digest_id?: string;
    },
  ): Promise<void> {
    const update: Record<string, unknown> = {
      status: args.status,
      executed_at: new Date().toISOString(),
    };
    if (args.result) update.result = args.result;
    if (args.error_message) update.error_message = args.error_message;
    if (args.digest_id) update.digest_id = args.digest_id;

    const { error } = await this.supabase.adminClient
      .from('automation_executions')
      .update(update)
      .eq('id', id);
    if (error) {
      this.log.warn(`markExecution falhou ${id}: ${error.message}`);
    }
  }

  // ────────────────────────────────────────────
  // 2.5) Send Direct (Storefront notifications da Loja Própria)
  //      Mensagem 1-a-1 transacional. Idempotente via dedup_key.
  // ────────────────────────────────────────────

  async sendDirect(input: SendDirectInput): Promise<SendDirectResult> {
    const orgId = await this.resolveActiveOrgId(input.organization_id);
    const message = (input.message ?? '').trim();
    if (!message) throw new BadRequestException('message é obrigatório');

    // Sanitiza phone — só dígitos, mínimo 10
    const phone = (input.phone ?? '').replace(/\D/g, '');
    if (phone.length < 10) {
      throw new BadRequestException('phone inválido (mínimo 10 dígitos)');
    }

    // Idempotência via dedup_key — checa execução prévia 'sent'
    if (input.dedup_key) {
      const existing = await this.findExecutionByDedupKey(orgId, input.dedup_key);
      if (existing && existing.status === 'sent') {
        return {
          ok: true,
          sent: false,
          skipped: true,
          reason: 'dedup_key já enviado anteriormente',
          execution_id: existing.id,
        };
      }
    }

    // Cria execução pending pra audit
    const exec = await this.insertExecution({
      org_id: orgId,
      execution_type: 'whatsapp_send_direct',
      severity: null,
      source_action_id: null,
      target_ref: input.dedup_key ?? null,
      payload: {
        phone,
        message,
        dedup_key: input.dedup_key ?? null,
      },
    });

    try {
      // Resolve canal WhatsApp ativo da org
      const channelId = await this.resolvePrimaryWhatsAppChannel(orgId);
      if (!channelId) {
        await this.markExecution(exec.id, {
          status: 'skipped',
          error_message: 'Org não tem canal WhatsApp ativo',
        });
        return {
          ok: true,
          sent: false,
          skipped: true,
          reason: 'Org não tem canal WhatsApp ativo',
          execution_id: exec.id,
        };
      }

      // Cria/recupera contato pelo telefone
      const contact = await this.contacts.findOrCreateByPhone(orgId, phone);

      // Envia via ChannelDispatcher (mesma pipeline do notifyLojista).
      // Com image_urls: manda cada imagem (a 1ª leva a mensagem como legenda).
      const imageUrls = (input.image_urls ?? []).filter(
        (u): u is string => typeof u === 'string' && /^https:\/\//.test(u),
      );
      let result;
      if (imageUrls.length > 0) {
        for (let i = 0; i < imageUrls.length; i++) {
          const content: Record<string, string> = { url: imageUrls[i] };
          if (i === 0) content.caption = message;
          result = await this.dispatcher.send({
            org_id: orgId,
            channel_id: channelId,
            contact_id: contact.id,
            content_type: 'image',
            content,
          });
        }
      } else {
        result = await this.dispatcher.send({
          org_id: orgId,
          channel_id: channelId,
          contact_id: contact.id,
          content_type: 'text',
          content: { body: message },
        });
      }

      await this.markExecution(exec.id, {
        status: 'sent',
        result: {
          channel_message_id: result?.channel_message_id,
          status: result?.status,
          contact_id: contact.id,
          images: imageUrls.length,
        },
      });

      return {
        ok: true,
        sent: true,
        execution_id: exec.id,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`sendDirect falhou exec=${exec.id}: ${msg}`);
      await this.markExecution(exec.id, {
        status: 'failed',
        error_message: msg.slice(0, 500),
      });
      return {
        ok: true,
        sent: false,
        skipped: true,
        reason: msg.slice(0, 200),
        execution_id: exec.id,
      };
    }
  }

  /** Procura execução prévia com mesmo dedup_key (target_ref).
   *  Retorna a mais recente (status mais informativo).
   *  Limita scope a execution_type='whatsapp_send_direct' pra não
   *  conflitar com target_ref de outros tipos. */
  private async findExecutionByDedupKey(
    orgId: string,
    dedupKey: string,
  ): Promise<AutomationExecutionRow | null> {
    const { data } = await this.supabase.adminClient
      .from('automation_executions')
      .select('*')
      .eq('org_id', orgId)
      .eq('execution_type', 'whatsapp_send_direct')
      .eq('target_ref', dedupKey)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as AutomationExecutionRow | null) ?? null;
  }

  // ────────────────────────────────────────────
  // 3) WhatsApp Broadcast (Onda 3 / S1 — bridge SaaS Conteúdo Social)
  // ────────────────────────────────────────────

  async sendBroadcast(
    input: SendBroadcastInput,
  ): Promise<SendBroadcastResult> {
    const orgId = await this.resolveActiveOrgId(input.organization_id);

    // Validações de input
    const message = (input.message ?? '').trim();
    if (!message) {
      throw new BadRequestException('message é obrigatório');
    }
    if (input.include_image && !input.image_url) {
      throw new BadRequestException(
        'include_image=true requer image_url',
      );
    }
    if (input.include_link && !input.link_url) {
      throw new BadRequestException(
        'include_link=true requer link_url',
      );
    }

    const rateLimit = Math.max(
      input.rate_limit_ms ?? DEFAULT_RATE_LIMIT_MS,
      BROADCAST_MIN_RATE_MS,
    );

    // Resolve audiência e checa limites
    const audience = await this.resolveBroadcastAudience(
      orgId,
      input.target_segment,
    );

    if (audience.length === 0) {
      return {
        ok: true,
        dispatched: 0,
        skipped: 0,
        errors: 0,
        audience_size: 0,
        execution_ids: [],
      };
    }

    if (
      audience.length > BROADCAST_LARGE_AUDIENCE &&
      !input.force_large_audience
    ) {
      throw new BadRequestException(
        `Audiência ${audience.length} excede ${BROADCAST_LARGE_AUDIENCE}. ` +
          `Inclua force_large_audience:true pra confirmar (cuidado: pode causar ban do WhatsApp).`,
      );
    }
    if (
      input.target_segment === 'todos' &&
      audience.length > BROADCAST_TODOS_WARN
    ) {
      this.log.warn(
        `[broadcast] segment=todos org=${orgId} audience=${audience.length} ` +
          `(>${BROADCAST_TODOS_WARN}) — risco de ban WhatsApp`,
      );
    }

    const finalMessage = buildBroadcastMessage(input, message);
    const isImage = !!(input.include_image && input.image_url);

    // Insere todas as execuções como pending — audit trail completo mesmo
    // se crashar no meio do dispatch.
    const executionIds: string[] = [];
    for (const c of audience) {
      const exec = await this.insertExecution({
        org_id: orgId,
        execution_type: 'whatsapp_broadcast',
        severity: null,
        source_action_id: input.source_content_id ?? null,
        target_ref: c.phone ?? c.id,
        payload: {
          source_content_id: input.source_content_id ?? null,
          target_segment: input.target_segment,
          message_preview: finalMessage.slice(0, 200),
          has_image: isImage,
          has_link: !!input.include_link,
        },
      });
      executionIds.push(exec.id);
    }

    let dispatched = 0;
    let skipped = 0;
    let errors = 0;

    // Dispatch sequencial respeitando rate limit
    for (let i = 0; i < audience.length; i++) {
      const contact = audience[i]!;
      const execId = executionIds[i]!;

      const outcome = await this.deliverBroadcast(
        orgId,
        execId,
        contact,
        finalMessage,
        isImage,
        input.image_url,
      );
      if (outcome === 'sent') dispatched++;
      else if (outcome === 'skipped') skipped++;
      else errors++;

      if (rateLimit > 0 && i < audience.length - 1) {
        await sleep(rateLimit);
      }
    }

    return {
      ok: true,
      dispatched,
      skipped,
      errors,
      audience_size: audience.length,
      execution_ids: executionIds,
    };
  }

  private async deliverBroadcast(
    orgId: string,
    executionId: string,
    contact: AudienceContact,
    body: string,
    isImage: boolean,
    imageUrl: string | undefined,
  ): Promise<'sent' | 'skipped' | 'failed'> {
    try {
      const channelId = await this.resolveContactWhatsAppChannel(
        orgId,
        contact.id,
      );
      if (!channelId) {
        await this.markExecution(executionId, {
          status: 'skipped',
          error_message: 'Contato sem canal WhatsApp ativo',
        });
        return 'skipped';
      }

      const result = await this.dispatcher.send({
        org_id: orgId,
        channel_id: channelId,
        contact_id: contact.id,
        content_type: isImage ? 'image' : 'text',
        content: isImage
          ? { url: imageUrl!, caption: body }
          : { body },
      });

      await this.markExecution(executionId, {
        status: 'sent',
        result: {
          channel_message_id: result.channel_message_id,
          status: result.status,
        },
      });
      return 'sent';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`broadcast falhou exec=${executionId}: ${msg}`);
      await this.markExecution(executionId, {
        status: 'failed',
        error_message: msg.slice(0, 500),
      });
      return 'failed';
    }
  }

  /**
   * Resolve a audiência do broadcast filtrando por segmento. Retorna
   * apenas contacts com `opted_out=false` e com algum identificador
   * WhatsApp (phone). RLS é segunda camada.
   */
  private async resolveBroadcastAudience(
    orgId: string,
    segment: BroadcastSegment,
  ): Promise<AudienceContact[]> {
    const fetchByIds = async (
      ids?: string[],
    ): Promise<AudienceContact[]> => {
      if (ids && ids.length === 0) return [];
      let q = this.supabase.adminClient
        .from('contacts')
        .select('id, phone, channel_profiles')
        .eq('org_id', orgId)
        .eq('opted_out', false)
        .not('phone', 'is', null);
      if (ids) q = q.in('id', ids);
      const { data, error } = await q.limit(BROADCAST_HARD_LIMIT);
      if (error) {
        throw new InternalServerErrorException(
          `Audience query falhou: ${error.message}`,
        );
      }
      return (data ?? []) as AudienceContact[];
    };

    const fetchBuyerIds = async (): Promise<Set<string>> => {
      const { data } = await this.supabase.adminClient
        .from('whatsapp_orders')
        .select('contact_id')
        .eq('org_id', orgId)
        .or(
          `payment_status.eq.paid,status.in.(${BUYER_ORDER_STATUSES.join(',')})`,
        )
        .limit(BROADCAST_HARD_LIMIT);
      const rows = (data ?? []) as Array<{ contact_id: string }>;
      return new Set(rows.map((r) => r.contact_id));
    };

    if (segment === 'todos') {
      return fetchByIds();
    }

    if (segment === 'compradores') {
      const ids = [...(await fetchBuyerIds())];
      return fetchByIds(ids);
    }

    if (segment === 'interessados') {
      const since30d = new Date(
        Date.now() - 30 * 24 * 3600_000,
      ).toISOString();
      const { data: convs } = await this.supabase.adminClient
        .from('conversations')
        .select('contact_id')
        .eq('org_id', orgId)
        .gte('last_message_at', since30d)
        .not('contact_id', 'is', null)
        .limit(BROADCAST_HARD_LIMIT);
      const recent = new Set(
        ((convs ?? []) as Array<{ contact_id: string }>).map(
          (r) => r.contact_id,
        ),
      );
      const buyers = await fetchBuyerIds();
      const ids = [...recent].filter((id) => !buyers.has(id));
      return fetchByIds(ids);
    }

    if (segment === 'inativos') {
      const cutoff60d = new Date(
        Date.now() - 60 * 24 * 3600_000,
      ).toISOString();
      // Contatos com QUALQUER conv mais antiga que 60d
      const { data: oldConvs } = await this.supabase.adminClient
        .from('conversations')
        .select('contact_id')
        .eq('org_id', orgId)
        .lt('last_message_at', cutoff60d)
        .not('contact_id', 'is', null)
        .limit(BROADCAST_HARD_LIMIT);
      const oldIds = [
        ...new Set(
          ((oldConvs ?? []) as Array<{ contact_id: string }>).map(
            (r) => r.contact_id,
          ),
        ),
      ];
      if (oldIds.length === 0) return [];

      // Excluir os que TÊM conv recente (=ainda ativos)
      const { data: recentConvs } = await this.supabase.adminClient
        .from('conversations')
        .select('contact_id')
        .eq('org_id', orgId)
        .gte('last_message_at', cutoff60d)
        .in('contact_id', oldIds);
      const stillActive = new Set(
        ((recentConvs ?? []) as Array<{ contact_id: string }>).map(
          (r) => r.contact_id,
        ),
      );
      const ids = oldIds.filter((id) => !stillActive.has(id));
      return fetchByIds(ids);
    }

    throw new BadRequestException(
      `target_segment inválido: ${segment}`,
    );
  }

  // ────────────────────────────────────────────
  // Digest worker — chamado pelo NotifyDigestWorker
  // ────────────────────────────────────────────

  /**
   * Pega execuções pendentes do tipo notify_lojista de uma severidade
   * específica e envia mensagem consolidada por org.
   *
   * Retorna stats agregados pra o worker logar.
   */
  async runDigest(
    severityBucket: 'medium' | 'low' | 'opportunity',
  ): Promise<{ orgs: number; sent: number; failed: number }> {
    const severities: AutomationSeverity[] =
      severityBucket === 'medium'
        ? ['medium']
        : severityBucket === 'low'
          ? ['low']
          : ['opportunity'];

    const { data: pending, error } = await this.supabase.adminClient
      .from('automation_executions')
      .select('*')
      .eq('execution_type', 'whatsapp_notify_lojista')
      .eq('status', 'pending')
      .in('severity', severities)
      .order('created_at', { ascending: true })
      .limit(1000);

    if (error) {
      this.log.warn(`runDigest query falhou: ${error.message}`);
      return { orgs: 0, sent: 0, failed: 0 };
    }

    const rows = (pending ?? []) as AutomationExecutionRow[];
    if (rows.length === 0) return { orgs: 0, sent: 0, failed: 0 };

    // Agrupa por org_id
    const byOrg = new Map<string, AutomationExecutionRow[]>();
    for (const r of rows) {
      const arr = byOrg.get(r.org_id) ?? [];
      arr.push(r);
      byOrg.set(r.org_id, arr);
    }

    let sent = 0;
    let failed = 0;
    const digestId = cryptoRandomUuid();

    for (const [orgId, orgRows] of byOrg.entries()) {
      try {
        const target = await this.resolveOwnerTarget(orgId);
        if (!target) {
          // Marca todas como skipped — owner não configurado
          for (const r of orgRows) {
            await this.markExecution(r.id, {
              status: 'skipped',
              error_message: 'Owner contact não configurado',
              digest_id: digestId,
            });
          }
          continue;
        }

        const body = formatDigestMessage(severityBucket, orgRows);
        const result = await this.dispatcher.send({
          org_id: orgId,
          channel_id: target.channel_id,
          contact_id: target.contact_id,
          content_type: 'text',
          content: { body },
        });

        for (const r of orgRows) {
          await this.markExecution(r.id, {
            status: 'sent',
            result: { channel_message_id: result.channel_message_id },
            digest_id: digestId,
          });
        }
        sent += orgRows.length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        for (const r of orgRows) {
          await this.markExecution(r.id, {
            status: 'failed',
            error_message: msg.slice(0, 500),
            digest_id: digestId,
          });
        }
        failed += orgRows.length;
      }
    }

    return { orgs: byOrg.size, sent, failed };
  }

  // ────────────────────────────────────────────
  // 5) Create Campaign Card (M4 — Campaign Center IA do SaaS)
  // ────────────────────────────────────────────

  /** Cria 1 deal no kanban + 1 task vinculada ao deal.
   *
   *  Chamado pelo SaaS quando um alerta de deadline dispara OU quando
   *  uma recomendação cai em pending_manager_approval. Permite que o
   *  operador veja a pendência no funil de Campanhas/Promoção do Active
   *  além de receber o WhatsApp.
   *
   *  Idempotência via dedup_key: se já existe deal com `metadata.dedup_key`
   *  igual, reusa esse deal (não cria duplicado). Task vai sempre se card
   *  for novo; se reuso de deal, task NÃO é recriada (operador já tem
   *  uma na lista).
   *
   *  Falha graciosa: se pipeline_id/stage_id/assigned_to inválidos, lança
   *  exception (SaaS captura no try/catch do alerts service).
   */
  async createCampaignCard(input: CreateCampaignCardInput): Promise<CreateCampaignCardResult> {
    if (!input.organization_id || !input.pipeline_id || !input.stage_id) {
      throw new BadRequestException('organization_id, pipeline_id, stage_id são obrigatórios');
    }
    input = { ...input, organization_id: await this.resolveActiveOrgId(input.organization_id) };
    // assigned_to opcional — resolve o dono da org se ausente.
    const assignedTo = input.assigned_to ?? (await this.resolveOrgOwnerMember(input.organization_id)) ?? undefined;

    // Dedup: se vier dedup_key, busca deal existente com mesma chave
    if (input.dedup_key) {
      const { data: existing } = await this.supabase.adminClient
        .from('deals')
        .select('id')
        .eq('org_id', input.organization_id)
        .filter('custom_fields->>dedup_key', 'eq', input.dedup_key)
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        this.log.log(`[campaign-card] dedup hit: deal ${existing.id} já existe pra ${input.dedup_key}`);
        return { ok: true, deal_id: existing.id, task_id: null, created: false };
      }
    }

    // 1. Cria deal via DealsService (passa por validação + emit event + webhook)
    const customFields: Record<string, unknown> = {
      ...(input.metadata ?? {}),
      ...(input.dedup_key ? { dedup_key: input.dedup_key } : {}),
      source: 'saas:ml-campaigns',
    };

    const deal = await this.deals.create(input.organization_id, {
      title:               input.title,
      pipeline_id:         input.pipeline_id,
      stage_id:            input.stage_id,
      assigned_to:         assignedTo,
      contact_id:          input.contact_id,
      value:               input.value,
      currency:            'BRL',
      expected_close_date: input.due_date,
      tags:                input.tags ?? ['campaign-center'],
      custom_fields:       customFields,
    });

    // 2. Cria task vinculada ao deal (exige um responsável)
    let taskId: string | null = null;
    if (assignedTo) {
      try {
        const task = await this.tasks.create(
          input.organization_id,
          {
            title:        input.task_title,
            description:  `Task gerada automaticamente pelo Campaign Center IA do SaaS.\n\nDedup: ${input.dedup_key ?? '-'}`,
            task_type:    'follow_up',
            priority:     'high',
            deal_id:      deal.id,
            assigned_to:  assignedTo,
            due_date:     input.due_date,
            created_by_ai: true,
            ai_context:   `ml-campaigns:${input.dedup_key ?? deal.id}`,
            metadata:     input.metadata ?? {},
          },
          null, // createdBy: null pois é server-to-server (não tem auth.users)
        );
        taskId = task.id;
      } catch (e) {
        // Falha na task NÃO desfaz o deal — log e segue.
        this.log.warn(`[campaign-card] task create failed pra deal ${deal.id}: ${(e as Error).message}`);
      }
    }

    return { ok: true, deal_id: deal.id, task_id: taskId, created: true };
  }

  // ────────────────────────────────────────────
  // 5b) Create Lead — formulário da Loja Própria → contato + deal
  // ────────────────────────────────────────────

  async createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
    if (!input.organization_id || !input.pipeline_id || !input.stage_id) {
      throw new BadRequestException('organization_id, pipeline_id, stage_id são obrigatórios');
    }
    input = { ...input, organization_id: await this.resolveActiveOrgId(input.organization_id) };
    const phone = (input.contact?.phone ?? '').replace(/\D/g, '');
    const email = (input.contact?.email ?? '').trim().toLowerCase();
    const name  = (input.contact?.name ?? '').trim() || undefined;
    if (!phone && !email) {
      throw new BadRequestException('contato precisa de phone ou email');
    }

    // Dedup: deal existente com mesma chave
    if (input.dedup_key) {
      const { data: existing } = await this.supabase.adminClient
        .from('deals')
        .select('id, contact_id, assigned_to')
        .eq('org_id', input.organization_id)
        .filter('custom_fields->>dedup_key', 'eq', input.dedup_key)
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        this.log.log(`[create-lead] dedup hit: deal ${existing.id}`);
        return {
          ok: true,
          deal_id: existing.id as string,
          contact_id: (existing.contact_id as string | null) ?? null,
          assigned_to: (existing.assigned_to as string | null) ?? null,
          created: false,
        };
      }
    }

    // 1. Upsert contato (phone preferido; senão email)
    let contactId: string | null = null;
    try {
      const contact = phone
        ? await this.contacts.findOrCreateByPhone(input.organization_id, phone, name)
        : await this.contacts.findOrCreateByEmail(input.organization_id, email, name);
      contactId = contact.id;
      // Completa email no contato se veio do form e ainda não tinha
      if (phone && email && !contact.email) {
        await this.supabase.adminClient
          .from('contacts')
          .update({ email })
          .eq('id', contact.id)
          .eq('org_id', input.organization_id);
      }
    } catch (e) {
      this.log.warn(`[create-lead] contato falhou: ${(e as Error).message}`);
    }

    // 2. Resolve assignee: input.assigned_to ou dono/primeiro membro da org
    const assignedTo = input.assigned_to ?? (await this.resolveOrgOwnerMember(input.organization_id));

    // 3. Cria deal vinculado ao contato
    const customFields: Record<string, unknown> = {
      ...(input.custom_fields ?? {}),
      ...(input.message ? { lead_message: input.message } : {}),
      ...(input.dedup_key ? { dedup_key: input.dedup_key } : {}),
      source: 'storefront:lead-form',
    };
    const title = (input.title ?? '').trim() || `${name ?? phone ?? email} — lead da loja`;
    const deal = await this.deals.create(input.organization_id, {
      title,
      pipeline_id:   input.pipeline_id,
      stage_id:      input.stage_id,
      contact_id:    contactId ?? undefined,
      assigned_to:   assignedTo ?? undefined,
      currency:      'BRL',
      tags:          input.tags ?? ['lead', 'loja-propria'],
      custom_fields: customFields,
    });

    this.log.log(`[create-lead] deal ${deal.id} criado (contato=${contactId ?? '-'}, assignee=${assignedTo ?? '-'})`);
    return { ok: true, deal_id: deal.id, contact_id: contactId, assigned_to: assignedTo, created: true };
  }

  // ────────────────────────────────────────────
  // 5c) Upsert Contact — cria/acha contato sem deal (Ambientador IA)
  // ────────────────────────────────────────────

  async upsertContact(input: UpsertContactInput): Promise<UpsertContactResult> {
    if (!input.organization_id) {
      throw new BadRequestException('organization_id é obrigatório');
    }
    input = { ...input, organization_id: await this.resolveActiveOrgId(input.organization_id) };
    const phone = (input.phone ?? '').replace(/\D/g, '');
    const email = (input.email ?? '').trim().toLowerCase();
    const name  = (input.name ?? '').trim() || undefined;
    if (!phone && !email) {
      throw new BadRequestException('contato precisa de phone ou email');
    }

    let contactId: string | null = null;
    let created = false;
    try {
      const contact = phone
        ? await this.contacts.findOrCreateByPhone(input.organization_id, phone, name)
        : await this.contacts.findOrCreateByEmail(input.organization_id, email, name);
      contactId = contact.id;
      // findOrCreate não retorna flag de "novo"; usamos created_at recente como heurística leve.
      created = Boolean(contact.created_at && Date.now() - new Date(contact.created_at).getTime() < 10_000);

      // Completa campos vazios + tags + source (não sobrescreve dados existentes)
      const patch: Record<string, unknown> = {};
      if (phone && email && !contact.email) patch.email = email;
      if (name && !contact.name) patch.name = name;
      if (input.source && !contact.source) patch.source = input.source;
      if (Array.isArray(input.tags) && input.tags.length) {
        const existing = Array.isArray(contact.tags) ? (contact.tags as string[]) : [];
        const merged = Array.from(new Set([...existing, ...input.tags]));
        if (merged.length !== existing.length) patch.tags = merged;
      }
      if (Object.keys(patch).length) {
        await this.supabase.adminClient
          .from('contacts')
          .update(patch)
          .eq('id', contact.id)
          .eq('org_id', input.organization_id);
      }
    } catch (e) {
      this.log.warn(`[upsert-contact] falhou: ${(e as Error).message}`);
      throw new InternalServerErrorException('Não foi possível criar/achar o contato');
    }

    return { ok: true, contact_id: contactId, created };
  }

  // ────────────────────────────────────────────
  // 5d) Ensure Service Pipeline — funil dedicado idempotente
  // ────────────────────────────────────────────

  async ensureServicePipeline(input: EnsureServicePipelineInput): Promise<EnsureServicePipelineResult> {
    if (!input.organization_id) throw new BadRequestException('organization_id é obrigatório');
    input = { ...input, organization_id: await this.resolveActiveOrgId(input.organization_id) };
    const name = (input.name ?? 'Atendimento da Loja').trim() || 'Atendimento da Loja';
    const stageNames = (input.stages && input.stages.length >= 2)
      ? input.stages
      : ['Novo', 'Em atendimento', 'Convertido', 'Perdido'];

    // Já existe funil com esse nome pra org? (idempotente)
    const { data: existing } = await this.supabase.adminClient
      .from('pipelines')
      .select('id')
      .eq('org_id', input.organization_id)
      .ilike('name', name)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      const stages = await this.fetchServiceStages(existing.id as string);
      return {
        ok: true,
        pipeline_id: existing.id as string,
        default_stage_id: stages[0]?.id ?? '',
        stages,
        created: false,
      };
    }

    // Cria funil + etapas
    const { data: pipelineRow, error: pErr } = await this.supabase.adminClient
      .from('pipelines')
      .insert({
        org_id: input.organization_id,
        name,
        is_default: false,
        settings: { source: 'storefront:visualizer' },
      })
      .select('id')
      .single();
    if (pErr || !pipelineRow) {
      throw new InternalServerErrorException(pErr?.message ?? 'Falha ao criar funil');
    }
    const pipelineId = pipelineRow.id as string;

    const palette = ['#06b6d4', '#6366f1', '#22c55e', '#ef4444', '#eab308', '#a855f7'];
    const stageRows = stageNames.map((nm, idx) => {
      const norm = normalizeStageName(nm);
      const isWon = /converti|ganho|won|vendid/.test(norm);
      const isLost = /perdid|lost|cancel/.test(norm);
      return {
        pipeline_id: pipelineId,
        name: nm,
        position: idx,
        color: isWon ? '#22c55e' : isLost ? '#ef4444' : palette[idx % palette.length],
        probability: isWon ? 100 : isLost ? 0 : Math.min(90, 10 + idx * 20),
        is_won: isWon,
        is_lost: isLost,
      };
    });
    const { error: sErr } = await this.supabase.adminClient
      .from('pipeline_stages')
      .insert(stageRows);
    if (sErr) {
      await this.supabase.adminClient.from('pipelines').delete().eq('id', pipelineId);
      throw new InternalServerErrorException(sErr.message);
    }

    const stages = await this.fetchServiceStages(pipelineId);
    this.log.log(`[ensure-pipeline] criado funil "${name}" (${pipelineId}) pra org ${input.organization_id}`);
    return {
      ok: true,
      pipeline_id: pipelineId,
      default_stage_id: stages[0]?.id ?? '',
      stages,
      created: true,
    };
  }

  private async fetchServiceStages(pipelineId: string): Promise<Array<{ id: string; name: string }>> {
    const { data } = await this.supabase.adminClient
      .from('pipeline_stages')
      .select('id, name, position')
      .eq('pipeline_id', pipelineId)
      .order('position', { ascending: true });
    return ((data ?? []) as Array<{ id: string; name: string }>).map(s => ({ id: s.id, name: s.name }));
  }

  /** Resolve o membro "dono" de uma org Active: prioriza role 'owner',
   *  depois 'admin', senão o primeiro membro ativo. Retorna org_members.id
   *  ou null se a org não tem membros. */
  private async resolveOrgOwnerMember(orgId: string): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('org_members')
      .select('id, role')
      .eq('org_id', orgId)
      .eq('status', 'active');
    const members = (data ?? []) as Array<{ id: string; role: string }>;
    if (members.length === 0) return null;
    const owner = members.find(m => m.role === 'owner')
      ?? members.find(m => m.role === 'admin')
      ?? members[0];
    return owner?.id ?? null;
  }

  // ────────────────────────────────────────────
  // 6) Move Card (funil Anúncios ML — avança card por evento do SaaS)
  // ────────────────────────────────────────────

  /**
   * Avança um card existente de etapa, achando-o pelo `dedup_key`.
   *
   * Chamado pelo SaaS quando: o anúncio é publicado (→ Incluir Campanha),
   * entra numa campanha ativa (→ Incluir ADS) ou o ADS é resolvido
   * (→ Concluído). Atualiza também o `action_link` do card (botão
   * contextual exibido no detalhe).
   *
   * Avança SÓ pra frente — se o card já está na etapa-alvo ou além, não
   * regride (evita que um evento atrasado puxe o card pra trás). A mudança
   * de etapa dispara as automações de `deal_stage_changed` (ex: a tarefa
   * de 3h por etapa).
   */
  async moveCard(input: MoveCardInput): Promise<MoveCardResult> {
    if (!input.deal_id && (!input.organization_id || !input.dedup_key)) {
      throw new BadRequestException(
        'Informe deal_id OU (organization_id + dedup_key)',
      );
    }
    if (!input.to_stage_id && !input.to_stage_name) {
      throw new BadRequestException('Informe to_stage_id ou to_stage_name');
    }
    // Traduz SaaS→Active só no caminho org+dedup_key (o caminho deal_id deriva
    // a org direto do deal, não precisa).
    if (input.organization_id) {
      input = { ...input, organization_id: await this.resolveActiveOrgId(input.organization_id) };
    }

    // Acha o deal: por id direto (deriva a org) ou por org + dedup_key.
    let dealData: unknown;
    if (input.deal_id) {
      const res = await this.supabase.adminClient
        .from('deals')
        .select('id, org_id, pipeline_id, stage_id, custom_fields')
        .eq('id', input.deal_id)
        .maybeSingle();
      dealData = res.data;
    } else {
      const res = await this.supabase.adminClient
        .from('deals')
        .select('id, org_id, pipeline_id, stage_id, custom_fields')
        .eq('org_id', input.organization_id!)
        .filter('custom_fields->>dedup_key', 'eq', input.dedup_key!)
        .limit(1)
        .maybeSingle();
      dealData = res.data;
    }

    if (!dealData) {
      this.log.log(
        `[move-card] nenhum card pra ${input.deal_id ?? `dedup_key=${input.dedup_key}`}`,
      );
      return { ok: true, found: false, deal_id: null, moved: false };
    }
    const deal = dealData as {
      id: string;
      org_id: string;
      pipeline_id: string;
      stage_id: string;
      custom_fields: Record<string, unknown> | null;
    };
    const orgId = deal.org_id;

    const { data: stagesData } = await this.supabase.adminClient
      .from('pipeline_stages')
      .select('id, name, position')
      .eq('pipeline_id', deal.pipeline_id);
    const stages = (stagesData ?? []) as Array<{ id: string; name: string; position: number }>;

    const target = input.to_stage_id
      ? stages.find((s) => s.id === input.to_stage_id)
      : stages.find(
          (s) => normalizeStageName(s.name) === normalizeStageName(input.to_stage_name ?? ''),
        );
    if (!target) {
      throw new NotFoundException(
        `Etapa destino não encontrada no funil: ${input.to_stage_id ?? input.to_stage_name}`,
      );
    }

    // Atualiza o action_link do card (merge no custom_fields).
    if (input.action_link !== undefined) {
      const merged: Record<string, unknown> = { ...(deal.custom_fields ?? {}) };
      if (input.action_link === null) delete merged.action_link;
      else merged.action_link = input.action_link;
      const { error: cfErr } = await this.supabase.adminClient
        .from('deals')
        .update({ custom_fields: merged })
        .eq('org_id', orgId)
        .eq('id', deal.id);
      if (cfErr) this.log.warn(`[move-card] patch custom_fields falhou: ${cfErr.message}`);
    }

    // Forward-only: não regride o card.
    if (target.id === deal.stage_id) {
      return { ok: true, found: true, deal_id: deal.id, moved: false, reason: 'já está nessa etapa' };
    }
    const current = stages.find((s) => s.id === deal.stage_id);
    if (current && target.position < current.position) {
      return {
        ok: true,
        found: true,
        deal_id: deal.id,
        moved: false,
        reason: 'card já está numa etapa mais avançada',
      };
    }

    await this.deals.moveToStage(orgId, deal.id, { stage_id: target.id });
    return { ok: true, found: true, deal_id: deal.id, moved: true };
  }
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

/** Normaliza nome de etapa pra casar por nome (minúsculo, sem acento). */
function normalizeStageName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

function formatLojistaMessage(input: NotifyLojistaInput): string {
  const head = `${SEVERITY_LABEL[input.severity]} — Loja AI`;
  const body = input.message.trim();
  const tail = input.deeplink ? `\n\n🔗 ${input.deeplink}` : '';
  return `${head}\n\n${body}${tail}`;
}

function formatDigestMessage(
  bucket: 'medium' | 'low' | 'opportunity',
  rows: AutomationExecutionRow[],
): string {
  const heading =
    bucket === 'medium'
      ? '🔔 Resumo das últimas 4h'
      : bucket === 'low'
        ? 'ℹ️ Resumo do dia'
        : '💡 Oportunidades do dia';

  const bullets = rows
    .map((r) => {
      const payload = r.payload as { message?: string; deeplink?: string };
      const text = (payload.message ?? '').trim().slice(0, 180);
      const link = payload.deeplink ? `\n   🔗 ${payload.deeplink}` : '';
      return `• ${text}${link}`;
    })
    .join('\n\n');

  return `${heading} (${rows.length} item${rows.length !== 1 ? 's' : ''})\n\n${bullets}`;
}

function formatCartRecoveryMessage(
  cart: {
    items: Array<{ name: string; quantity: number }>;
    total: number;
  },
  args: { templateKey?: string; customMessage?: string },
): string {
  if (args.customMessage) return args.customMessage;

  const itemsCount = (cart.items ?? []).reduce(
    (acc, it) => acc + (it.quantity ?? 0),
    0,
  );
  const total = formatBRL(Number(cart.total ?? 0));

  // template_key é placeholder pra futura tabela whatsapp_product_messages —
  // por ora, default é o mesmo template do B5 (cart_abandoned default).
  return [
    `Oi! 👋`,
    ``,
    `Vi que você ficou de finalizar seu pedido — ${itemsCount} item(s) no valor de ${total}.`,
    ``,
    `Posso te ajudar a fechar? Se preferir, é só responder aqui.`,
  ].join('\n');
}

/**
 * Constrói o texto final do broadcast — substitui placeholder
 * `[LINK DO PRODUTO]` se existir; senão appenda link no final.
 * `messageTrimmed` é o input.message já trimado.
 */
function buildBroadcastMessage(
  input: SendBroadcastInput,
  messageTrimmed: string,
): string {
  let text = messageTrimmed;
  if (input.include_link && input.link_url) {
    if (text.includes(BROADCAST_PLACEHOLDER)) {
      text = text.split(BROADCAST_PLACEHOLDER).join(input.link_url);
    } else {
      text = `${text}\n\n👉 ${input.link_url}`;
    }
  }
  return text;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value) || 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cryptoRandomUuid(): string {
  // Compat: Node 18+ tem globalThis.crypto.randomUUID
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback simples — não é security-critical, é só agrupador de digest
  return `dgst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
