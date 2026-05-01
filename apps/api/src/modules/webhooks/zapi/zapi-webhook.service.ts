import { Injectable, Logger } from '@nestjs/common';
import type {
  Channel,
  Json,
  MessageContent,
  MessageContentType,
} from '@eclick-active/shared';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../../common/channels/channel-dispatcher.service';
import { ZapiProvider } from '../../../common/channels/providers/zapi/zapi.provider';
import type { ZapiInboundPayload } from '../../../common/channels/providers/zapi/zapi.types';
import { ContactsService } from '../../contacts/contacts.service';
import { ConversationsService } from '../../conversations/conversations.service';

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

    // 6. Persiste mensagem inbound
    await this.persistInbound({
      channel,
      conversationId: conversation.id,
      contentType: data.content_type,
      content: data.content,
      channelMessageId: data.channel_message_id,
      occurredAt: inbound.occurred_at,
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
  }): Promise<void> {
    const plainText = this.extractPlainText(input.contentType, input.content);

    const { error } = await this.supabase.adminClient.from('messages').insert({
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
    });

    if (error) {
      this.logger.error(`persistInbound failed: ${error.message}`);
      throw new Error(`Failed to persist inbound message: ${error.message}`);
    }
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
