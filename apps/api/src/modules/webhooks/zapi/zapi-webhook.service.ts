import { Injectable, Logger } from '@nestjs/common';
import type {
  Channel,
  Json,
  Message,
  MessageContent,
  MessageContentType,
} from '@eclick-active/shared';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../../common/channels/channel-dispatcher.service';
import { ZapiProvider } from '../../../common/channels/providers/zapi/zapi.provider';
import type { ZapiInboundPayload } from '../../../common/channels/providers/zapi/zapi.types';
import { ContactsService } from '../../contacts/contacts.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { EventsGateway } from '../../../gateways/events.gateway';
import { AiService } from '../../ai/ai.service';
import { AutomationsService } from '../../automations/automations.service';
import { AutoLeadService } from '../auto-lead.service';

export interface WebhookHandleResult {
  accepted: boolean;
  reason?: string;
}

/**
 * Orquestra o processamento de webhooks da Z-API:
 *   1. Resolve o channel pelo `instanceId` do payload
 *   2. findOrCreateContact por telefone (com nome/foto do payload)
 *   3. findOrCreateConversation
 *   4. Persiste mensagem inbound em active.messages (trigger atualiza
 *      counters da conversation)
 */
@Injectable()
export class ZapiWebhookService {
  private readonly logger = new Logger(ZapiWebhookService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly zapi: ZapiProvider,
    private readonly contacts: ContactsService,
    private readonly conversations: ConversationsService,
    private readonly events: EventsGateway,
    private readonly ai: AiService,
    private readonly automations: AutomationsService,
    private readonly autoLead: AutoLeadService,
  ) {}

  async handle(payload: ZapiInboundPayload): Promise<WebhookHandleResult> {
    // ── Filtros cheap antes do DB lookup ──
    if (typeof payload.instanceId !== 'string' || !payload.instanceId) {
      return { accepted: false, reason: 'missing_instance_id' };
    }
    if (payload.isGroup) {
      return { accepted: false, reason: 'group_not_supported' };
    }
    if (payload.type !== 'ReceivedCallback') {
      // DeliveryCallback / ReadCallback / etc — fora de escopo da Tarefa 3.
      // Ignoramos sem custo de DB.
      this.logger.debug(`Ignoring non-ReceivedCallback type=${payload.type}`);
      return { accepted: false, reason: `ignored_type:${payload.type}` };
    }

    // ── DB: resolve channel pelo instanceId ──
    const channel = await this.dispatcher.findChannelByZapiInstanceId(
      payload.instanceId,
    );
    if (!channel) {
      this.logger.warn(`No active channel for instanceId=${payload.instanceId}`);
      return { accepted: false, reason: 'unknown_instance' };
    }

    // ── Parse via provider ──
    const events = await this.zapi.receiveWebhook(payload);
    const inbound = events.find((e) => e.type === 'message.received');
    if (!inbound) {
      return { accepted: false, reason: 'no_inbound_event' };
    }

    const data = inbound.data as unknown as {
      phone: string;
      channel_message_id?: string;
      sender_name?: string;
      avatar_url?: string;
      content_type: MessageContentType;
      content: MessageContent;
    };

    // 4. findOrCreate contact
    const contact = await this.contacts.findOrCreateByPhone(
      channel.org_id,
      payload.phone,
      data.sender_name,
    );

    // 4a. Enriquece nome/avatar no contato se ainda não tiver
    const patch: { name?: string; avatar_url?: string } = {};
    if (data.sender_name && !contact.name) patch.name = data.sender_name;
    if (data.avatar_url && !contact.avatar_url) patch.avatar_url = data.avatar_url;
    if (Object.keys(patch).length > 0) {
      await this.contacts.update(channel.org_id, contact.id, patch);
    }

    // 5. findOrCreate conversation
    const conversation = await this.conversations.findOrCreate(
      channel.org_id,
      contact.id,
      channel.id,
      'whatsapp',
    );

    // 6. Persiste mensagem inbound (idempotente — duplicatas são ignoradas)
    const result = await this.persistInbound({
      channel,
      conversationId: conversation.id,
      contentType: data.content_type,
      content: data.content,
      channelMessageId: data.channel_message_id,
      occurredAt: inbound.occurred_at,
    });

    if (result.duplicate || !result.message) {
      return { accepted: false, reason: 'duplicate' };
    }

    // 7. Emite eventos pro frontend conectado via WebSocket. Falhas aqui
    //    não derrubam o webhook — o evento é "best-effort" e o frontend
    //    pode reconciliar via fetch quando voltar a se conectar.
    try {
      this.events.emitToOrg(channel.org_id, 'message:new', {
        conversation_id: conversation.id,
        message: result.message,
      });

      // Re-fetch conversation pra pegar counters atualizados pelo trigger
      // trg_message_insert (message_count, last_message_at, unread_count).
      const updatedConv = await this.conversations.findByIdRaw(
        channel.org_id,
        conversation.id,
      );
      this.events.emitToOrg(channel.org_id, 'conversation:updated', {
        conversation: updatedConv,
      });
    } catch (err) {
      this.logger.warn(
        `Event emit failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 8. Fire-and-forget: classifica + sugere resposta. NÃO awaiteamos —
    //    o webhook precisa retornar 200 em <5s. AiService.processInbound
    //    tem catch interno e emite ai:suggestion via WebSocket quando pronto.
    void this.ai
      .processInbound(channel.org_id, conversation.id, result.message.id)
      .catch((err) => {
        this.logger.warn(
          `AI processing failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    // 8a. Fire-and-forget: auto-create deal pra contatos novos quando a
    //     org tem `settings.auto_create_deal.enabled = true`. O service
    //     ignora silenciosamente se setting desabilitada / contato já tem
    //     deal ativo / sem pipeline configurado.
    void this.autoLead.handleNewContact({
      orgId: channel.org_id,
      contactId: contact.id,
      conversationId: conversation.id,
    });

    // 9. Fire-and-forget: dispara automações com trigger=message_received.
    //    Não bloqueia o webhook (tem 5s de SLA). ai_intent pode estar null
    //    nesse momento (a IA classifica em paralelo); automações que
    //    filtram por intent simplesmente não vão casar até o reprocesso.
    void this.automations
      .checkTriggers({
        event: 'message_received',
        org_id: channel.org_id,
        conversation_id: conversation.id,
        contact_id: contact.id,
        channel_id: channel.id,
        channel_type: channel.channel_type,
        message_id: result.message.id,
        message_text: result.message.plain_text ?? '',
        ai_intent: result.message.ai_intent ?? null,
      })
      .catch((err) => {
        this.logger.warn(
          `automations checkTriggers failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    return { accepted: true };
  }

  private async persistInbound(input: {
    channel: Channel;
    conversationId: string;
    contentType: MessageContentType;
    content: MessageContent;
    channelMessageId?: string;
    occurredAt: string;
  }): Promise<{ duplicate: boolean; message: Message | null }> {
    const plainText = this.extractPlainText(input.contentType, input.content);

    const { data, error } = await this.supabase.adminClient
      .from('messages')
      .insert({
        org_id: input.channel.org_id,
        conversation_id: input.conversationId,
        direction: 'inbound',
        sender_type: 'contact',
        sender_id: null,
        content_type: input.contentType,
        content: input.content as unknown as Json,
        plain_text: plainText,
        channel_message_id: input.channelMessageId ?? null,
        status: 'delivered',
        is_internal_note: false,
        metadata: {},
        // created_at default is now() — não passamos occurred_at aqui pra
        // não bagunçar o particionamento; mantemos a info em metadata se
        // quiser auditar discrepância depois.
      })
      .select('*')
      .single();

    if (error) {
      // 23505 = unique_violation — duplicata pelo índice idx_messages_*_dedup
      // (definido em supabase/migrations/003_messages_dedup_index.sql).
      // Webhook idempotente: ignoramos sem erro.
      if ((error as { code?: string }).code === '23505') {
        this.logger.debug(
          `Duplicate inbound ignored (channel_message_id=${input.channelMessageId})`,
        );
        return { duplicate: true, message: null };
      }
      this.logger.error(`persistInbound failed: ${error.message}`);
      throw new Error(`Failed to persist inbound message: ${error.message}`);
    }
    return { duplicate: false, message: (data ?? null) as Message | null };
  }

  private extractPlainText(
    type: MessageContentType,
    content: MessageContent,
  ): string | null {
    if (type === 'text' && 'body' in content && typeof content.body === 'string') {
      return content.body;
    }
    if (
      (type === 'image' || type === 'video') &&
      'caption' in content &&
      typeof content.caption === 'string'
    ) {
      return content.caption;
    }
    if (
      type === 'document' &&
      'filename' in content &&
      typeof content.filename === 'string'
    ) {
      return content.filename;
    }
    return null;
  }
}
