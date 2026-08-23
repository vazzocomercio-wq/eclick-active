import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Channel, Json, Message, MessageContent, MessageContentType } from '@eclick-active/shared';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../../common/channels/channel-dispatcher.service';
import { InstagramProvider } from '../../../common/channels/providers/instagram/instagram.provider';
import type {
  InstagramCredentials,
  InstagramWebhookBody,
} from '../../../common/channels/providers/instagram/instagram.types';
import { ContactsService } from '../../contacts/contacts.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { EventsGateway } from '../../../gateways/events.gateway';
import { AiService } from '../../ai/ai.service';
import { AutomationsService } from '../../automations/automations.service';
import { AutoLeadService } from '../auto-lead.service';

export interface InstagramWebhookHandleResult {
  accepted: boolean;
  reason?: string;
  events_processed?: number;
}

/**
 * Orquestra processamento de webhooks do Instagram. Mesmo padrão do
 * ZapiWebhookService:
 *   1. Verifica HMAC se META_APP_SECRET configurado
 *   2. Para cada entry → resolve channel pelo ig_user_id
 *   3. Pra cada messaging event:
 *      - message → findOrCreateContact + findOrCreateConversation + persist + AI fire-and-forget
 *      - delivery → UPDATE messages SET status='delivered'
 *      - read     → UPDATE messages com timestamp <= watermark SET status='read'
 *   4. Sempre 200 (Meta retry agressivo)
 */
@Injectable()
export class InstagramWebhookService {
  private readonly logger = new Logger(InstagramWebhookService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly instagram: InstagramProvider,
    private readonly contacts: ContactsService,
    private readonly conversations: ConversationsService,
    private readonly events: EventsGateway,
    private readonly ai: AiService,
    private readonly automations: AutomationsService,
    private readonly autoLead: AutoLeadService,
  ) {}

  /**
   * Verifica X-Hub-Signature-256 (HMAC-SHA256 do raw body com app secret).
   *
   * FALHA FECHADA em produção. Antes, sem `META_APP_SECRET` esta função
   * devolvia `true` — e a env nunca foi configurada no Railway (auditoria
   * 23/08/2026), então o endpoint público aceitava qualquer payload não
   * assinado. Quem soubesse a URL conseguiria injetar DM falsa no CRM:
   * contato, conversa e mensagem criados, mais o pipeline de IA e as
   * automações disparando em cima de conteúdo forjado.
   *
   * Fora de produção o bypass continua, pra não travar teste local — mas
   * loga como erro, não como aviso.
   */
  verifySignature(rawBody: Buffer | string, signatureHeader: string | undefined): boolean {
    const secret = process.env.META_APP_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          'META_APP_SECRET ausente em produção — REJEITANDO webhook do Instagram. ' +
          'Configure a env no Railway (service api) pra receber DMs.',
        );
        return false;
      }
      this.logger.error('META_APP_SECRET ausente — pulando validação de assinatura (SÓ FORA DE PRODUÇÃO)');
      return true;
    }
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      return false;
    }
    const expected = signatureHeader.slice(7);
    const computed = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (expected.length !== computed.length) return false;
    // timing-safe compare
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ computed.charCodeAt(i);
    }
    return mismatch === 0;
  }

  async handle(body: InstagramWebhookBody): Promise<InstagramWebhookHandleResult> {
    if (body.object !== 'instagram' || !Array.isArray(body.entry)) {
      return { accepted: false, reason: 'invalid_object' };
    }

    const events = await this.instagram.receiveWebhook(body);
    if (events.length === 0) {
      return { accepted: false, reason: 'no_events' };
    }

    let processed = 0;
    for (const entry of body.entry) {
      const igUserId = entry.id;
      const channel = await this.dispatcher.findChannelByInstagramIgUserId(igUserId);
      if (!channel) {
        this.logger.warn(`No active IG channel for ig_user_id=${igUserId}`);
        continue;
      }

      const entryEvents = events.filter(
        (e) =>
          (e.data as { ig_user_id?: string } | null)?.ig_user_id === igUserId ||
          e.channel_id === igUserId,
      );

      for (const ev of entryEvents) {
        try {
          if (ev.type === 'message.received') {
            await this.handleInbound(channel, ev);
          } else if (ev.type === 'message.status') {
            await this.handleStatus(channel, ev);
          }
          processed++;
        } catch (err) {
          this.logger.error(
            `Falha ao processar evento ${ev.type}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return { accepted: true, events_processed: processed };
  }

  private async handleInbound(
    channel: Channel,
    event: { type: string; occurred_at: string; data: Json },
  ): Promise<void> {
    const data = event.data as unknown as {
      sender_id: string;
      recipient_id: string;
      channel_message_id: string;
      content_type: MessageContentType;
      content: MessageContent;
      text: string | null;
      reply_to: string | null;
      ig_user_id: string;
      instagram_event?: string;
    };

    // 1. Busca perfil do contato (best-effort — pode falhar se IG não permitir).
    // Descriptografa token antes de chamar fetchProfile.
    let profile: { external_id: string; name?: string; avatar_url?: string } | null = null;
    try {
      const decryptedCreds = this.instagram.decryptCredentials(channel.credentials);
      profile = await this.instagram.fetchProfile(decryptedCreds, data.sender_id);
    } catch (err) {
      this.logger.debug(
        `fetchProfile falhou (não-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 2. findOrCreateContact via PSID (vai virar phone='ig:<psid>')
    const contact = await this.contacts.findOrCreateByInstagramPsid(
      channel.org_id,
      data.sender_id,
      profile?.name,
      profile?.avatar_url,
    );

    // 3. Enriquece contato (nome/avatar) se ainda vazios
    const patch: { name?: string; avatar_url?: string } = {};
    if (profile?.name && !contact.name) patch.name = profile.name;
    if (profile?.avatar_url && !contact.avatar_url) patch.avatar_url = profile.avatar_url;
    if (Object.keys(patch).length > 0) {
      await this.contacts.update(channel.org_id, contact.id, patch);
    }

    // 4. findOrCreateConversation
    const conversation = await this.conversations.findOrCreate(
      channel.org_id,
      contact.id,
      channel.id,
      'instagram',
    );

    // 5. Persiste mensagem (idempotente via channel_message_id unique)
    const result = await this.persistInbound({
      channel,
      conversationId: conversation.id,
      contentType: data.content_type,
      content: data.content,
      channelMessageId: data.channel_message_id,
      occurredAt: event.occurred_at,
      plainText: data.text ?? this.pickPlainText(data.content_type, data.content),
      metadata: data.instagram_event ? { instagram_event: data.instagram_event } : undefined,
    });

    if (result.duplicate || !result.message) return;

    // 6. Eventos WebSocket pra UI atualizar inbox em real-time
    try {
      this.events.emitToOrg(channel.org_id, 'message:new', {
        conversation_id: conversation.id,
        message: result.message,
      });
      const updatedConv = await this.conversations.findByIdRaw(channel.org_id, conversation.id);
      if (updatedConv) {
        this.events.emitToOrg(channel.org_id, 'conversation:updated', {
          conversation: updatedConv,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Event emit falhou (não-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 7. Fire-and-forget: pipeline de IA (classify + suggest + auto-deal)
    void this.ai
      .processInbound(channel.org_id, conversation.id, result.message.id)
      .catch((err) => {
        this.logger.warn(
          `AI processing falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    void this.autoLead
      .handleNewContact({
        orgId: channel.org_id,
        contactId: contact.id,
        conversationId: conversation.id,
      })
      .catch(() => {});

    void this.automations
      .checkTriggers({
        event: 'message_received',
        org_id: channel.org_id,
        conversation_id: conversation.id,
        contact_id: contact.id,
        channel_id: channel.id,
        channel_type: 'instagram',
        message_id: result.message.id,
        message_text: result.message.plain_text ?? '',
        ai_intent: result.message.ai_intent ?? null,
      })
      .catch(() => {});
  }

  private async handleStatus(
    channel: Channel,
    event: { type: string; data: Json },
  ): Promise<void> {
    const data = event.data as unknown as {
      channel_message_id?: string;
      status: 'delivered' | 'read';
      read_watermark?: number;
      recipient_id?: string;
    };

    if (data.status === 'delivered' && data.channel_message_id) {
      await this.supabase.adminClient
        .from('messages')
        .update({ status: 'delivered' })
        .eq('org_id', channel.org_id)
        .eq('channel_message_id', data.channel_message_id);
    } else if (data.status === 'read' && data.read_watermark) {
      // Read watermark = todas as mensagens enviadas até esse timestamp foram lidas.
      // Atualiza outbound messages do canal com timestamp <= watermark.
      const watermarkIso = new Date(data.read_watermark).toISOString();
      await this.supabase.adminClient
        .from('messages')
        .update({ status: 'read' })
        .eq('org_id', channel.org_id)
        .eq('channel_id', channel.id)
        .eq('direction', 'outbound')
        .lte('created_at', watermarkIso)
        .neq('status', 'read');
    }
  }

  private async persistInbound(input: {
    channel: Channel;
    conversationId: string;
    contentType: MessageContentType;
    content: MessageContent;
    channelMessageId: string;
    occurredAt: string;
    plainText: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<{ message: Message | null; duplicate: boolean }> {
    // Idempotência: se já existe mensagem com mesmo channel_message_id, retorna duplicate
    const existing = await this.supabase.adminClient
      .from('messages')
      .select('id')
      .eq('org_id', input.channel.org_id)
      .eq('channel_message_id', input.channelMessageId)
      .maybeSingle();
    if ((existing.data as { id: string } | null)?.id) {
      return { message: null, duplicate: true };
    }

    const { data, error } = await this.supabase.adminClient
      .from('messages')
      .insert({
        org_id: input.channel.org_id,
        conversation_id: input.conversationId,
        channel_id: input.channel.id,
        channel_message_id: input.channelMessageId,
        direction: 'inbound',
        content_type: input.contentType,
        content: input.content as unknown as Json,
        plain_text: input.plainText,
        sender_type: 'contact',
        status: 'delivered',
        created_at: input.occurredAt,
        metadata: (input.metadata ?? {}) as unknown as Json,
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`persistInbound falhou: ${error?.message}`);
      return { message: null, duplicate: false };
    }
    return { message: data as Message, duplicate: false };
  }

  private pickPlainText(
    contentType: MessageContentType,
    content: MessageContent,
  ): string | null {
    if (contentType === 'text') {
      const c = content as unknown as Record<string, unknown> | null;
      const body = c?.body;
      return typeof body === 'string' ? body : null;
    }
    return null;
  }
}
