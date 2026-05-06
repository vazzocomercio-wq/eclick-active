import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../common/channels/channel-dispatcher.service';
import type {
  AutomationExecutionRow,
  AutomationSeverity,
  CartSegment,
  ExecutionType,
  NotifyLojistaInput,
  NotifyLojistaResult,
  OrgAutomationBridgeSettings,
  TriggerCartRecoveryInput,
  TriggerCartRecoveryResult,
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
  ) {}

  // ────────────────────────────────────────────
  // 1) Notify Lojista
  // ────────────────────────────────────────────

  async notifyLojista(input: NotifyLojistaInput): Promise<NotifyLojistaResult> {
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
    const orgId = input.organization_id;
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
    const { data } = await this.supabase.adminClient
      .from('channels')
      .select('id')
      .eq('org_id', orgId)
      .eq('channel_type', 'whatsapp')
      .eq('is_active', true)
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
      return ch?.channel_type === 'whatsapp';
    });
    if (found) return found.channel_id;

    return this.resolvePrimaryWhatsAppChannel(orgId);
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
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

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
