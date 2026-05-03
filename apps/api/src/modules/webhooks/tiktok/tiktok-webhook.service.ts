import { Injectable, Logger } from '@nestjs/common';
import type {
  Channel,
  Json,
  Message,
  MessageContent,
} from '@eclick-active/shared';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../../common/channels/channel-dispatcher.service';
import { TikTokProvider } from '../../../common/channels/providers/tiktok/tiktok.provider';
import type { TikTokWebhookBody } from '../../../common/channels/providers/tiktok/tiktok.types';
import { ContactsService } from '../../contacts/contacts.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { EventsGateway } from '../../../gateways/events.gateway';
import { AiService } from '../../ai/ai.service';
import { AutomationsService } from '../../automations/automations.service';
import { AutoLeadService } from '../auto-lead.service';

/**
 * Pipeline TikTok — comentários e follows viram conversations + messages.
 *
 *   1. Resolve channel via to_user_id (open_id do business)
 *   2. comment.create/reply:
 *      - findOrCreateContact por open_id (phone='tt:<open_id>')
 *      - Cria tiktok_interaction (comment)
 *      - findOrCreateConversation('tiktok')
 *      - Persiste message com metadata { video_id, video_url, comment_id }
 *      - Fire-and-forget AI (classify + suggest)
 *      - Emit events
 *   3. follow:
 *      - findOrCreateContact (lead)
 *      - Cria tiktok_interaction (follow)
 *      - Notifica agente via WebSocket
 */
@Injectable()
export class TikTokWebhookService {
  private readonly logger = new Logger(TikTokWebhookService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly tiktok: TikTokProvider,
    private readonly contacts: ContactsService,
    private readonly conversations: ConversationsService,
    private readonly events: EventsGateway,
    private readonly ai: AiService,
    private readonly automations: AutomationsService,
    private readonly autoLead: AutoLeadService,
  ) {}

  async handle(body: TikTokWebhookBody): Promise<{ accepted: boolean; reason?: string }> {
    if (!body || !body.event) {
      return { accepted: false, reason: 'invalid_body' };
    }

    const businessOpenId = body.to_user_id;
    if (!businessOpenId) {
      return { accepted: false, reason: 'missing_to_user_id' };
    }

    // Resolve channel
    const channel = await this.findChannelByOpenId(businessOpenId);
    if (!channel) {
      this.logger.warn(`TikTok webhook sem canal pra open_id=${businessOpenId}`);
      return { accepted: false, reason: 'unknown_channel' };
    }

    switch (body.event) {
      case 'comment.create':
      case 'comment.reply':
        await this.handleComment(channel, body);
        break;
      case 'follow':
        await this.handleFollow(channel, body);
        break;
      default:
        this.logger.debug(`TikTok event ignorado: ${body.event}`);
    }

    return { accepted: true };
  }

  // ──────────────────────────────────────────────────────────
  // comment.create / comment.reply
  // ──────────────────────────────────────────────────────────

  private async handleComment(channel: Channel, body: TikTokWebhookBody): Promise<void> {
    const userOpenId = body.user_open_id;
    const commentId = body.comment_id;
    const videoId = body.video_id;
    const text = body.content ?? '';

    if (!userOpenId || !commentId) {
      this.logger.warn(`Comment sem user_open_id ou comment_id — ignorado`);
      return;
    }

    // Idempotência: se já temos esse comment_id, ignora
    const { data: existing } = await this.supabase.adminClient
      .from('tiktok_interactions')
      .select('id')
      .eq('org_id', channel.org_id)
      .eq('channel_id', channel.id)
      .eq('comment_id', commentId)
      .maybeSingle();
    if ((existing as { id: string } | null)?.id) return;

    // findOrCreateContact via open_id (similar ao Instagram PSID)
    const contact = await this.contacts.findOrCreateByTikTokOpenId(
      channel.org_id,
      userOpenId,
      body.username ?? undefined,
      body.user_avatar_url ?? undefined,
    );

    // Conversation por canal+contato
    const conversation = await this.conversations.findOrCreate(
      channel.org_id,
      contact.id,
      channel.id,
      'tiktok',
    );

    // Persist tiktok_interaction (audit trail rico) + message
    const interactionRow = await this.supabase.adminClient
      .from('tiktok_interactions')
      .insert({
        org_id: channel.org_id,
        channel_id: channel.id,
        contact_id: contact.id,
        conversation_id: conversation.id,
        interaction_type: 'comment',
        video_id: videoId ?? null,
        video_url: body.video_url ?? null,
        comment_id: commentId,
        parent_comment_id: body.parent_comment_id ?? null,
        content: text,
        username: body.username ?? null,
        user_avatar_url: body.user_avatar_url ?? null,
        external_user_id: userOpenId,
      })
      .select('id')
      .single();
    if (interactionRow.error) {
      this.logger.error(`Persist tiktok_interaction falhou: ${interactionRow.error.message}`);
    }

    // Persist message (idempotência via channel_message_id = comment_id)
    const content: MessageContent = {
      body: text,
      tiktok_video_id: videoId,
      tiktok_video_url: body.video_url,
      tiktok_comment_id: commentId,
    } as unknown as MessageContent;

    const { data: msg, error: msgErr } = await this.supabase.adminClient
      .from('messages')
      .insert({
        org_id: channel.org_id,
        conversation_id: conversation.id,
        channel_id: channel.id,
        channel_message_id: commentId,
        direction: 'inbound',
        content_type: 'text',
        content: content as unknown as Json,
        plain_text: text,
        sender_type: 'contact',
        status: 'delivered',
        created_at: new Date((body.create_time ?? Date.now() / 1000) * 1000).toISOString(),
        metadata: {
          tiktok: {
            video_id: videoId,
            video_url: body.video_url,
            comment_id: commentId,
            parent_comment_id: body.parent_comment_id,
            username: body.username,
          },
        } as unknown as Json,
      })
      .select('*')
      .single();

    if (msgErr || !msg) {
      this.logger.error(`Persist tiktok message falhou: ${msgErr?.message}`);
      return;
    }

    const message = msg as Message;

    // Eventos WebSocket
    try {
      this.events.emitToOrg(channel.org_id, 'message:new', {
        conversation_id: conversation.id,
        message,
      });
      const updatedConv = await this.conversations.findByIdRaw(channel.org_id, conversation.id);
      if (updatedConv) {
        this.events.emitToOrg(channel.org_id, 'conversation:updated', {
          conversation: updatedConv,
        });
      }
    } catch (err) {
      this.logger.warn(`Event emit falhou: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Fire-and-forget AI (classify + suggest reply curto pra TikTok)
    void this.ai
      .processInbound(channel.org_id, conversation.id, message.id)
      .catch(() => {});

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
        channel_type: 'tiktok',
        message_id: message.id,
        message_text: text,
        ai_intent: null,
      })
      .catch(() => {});
  }

  // ──────────────────────────────────────────────────────────
  // follow
  // ──────────────────────────────────────────────────────────

  private async handleFollow(channel: Channel, body: TikTokWebhookBody): Promise<void> {
    if (!body.user_open_id) return;

    const contact = await this.contacts.findOrCreateByTikTokOpenId(
      channel.org_id,
      body.user_open_id,
      body.username ?? undefined,
      body.user_avatar_url ?? undefined,
    );

    await this.supabase.adminClient.from('tiktok_interactions').insert({
      org_id: channel.org_id,
      channel_id: channel.id,
      contact_id: contact.id,
      interaction_type: 'follow',
      username: body.username ?? null,
      user_avatar_url: body.user_avatar_url ?? null,
      external_user_id: body.user_open_id,
    });

    // Notifica agente via notificação interna
    await this.supabase.adminClient.from('notifications').insert({
      org_id: channel.org_id,
      type: 'tiktok_follow',
      severity: 'info',
      title: `Novo seguidor TikTok`,
      body: `@${body.username ?? body.user_open_id} começou a seguir`,
      link: `/contatos?id=${contact.id}`,
      metadata: { contact_id: contact.id, channel_id: channel.id },
    });

    // Cria conversation pra follow (autoLead exige conversationId).
    // Mantém conversation tipo 'tiktok' mesmo sem mensagem ainda — agente
    // pode iniciar contato manualmente.
    const conversation = await this.conversations.findOrCreate(
      channel.org_id,
      contact.id,
      channel.id,
      'tiktok',
    );

    void this.autoLead
      .handleNewContact({
        orgId: channel.org_id,
        contactId: contact.id,
        conversationId: conversation.id,
      })
      .catch(() => {});
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  private async findChannelByOpenId(openId: string): Promise<Channel | null> {
    const { data } = await this.supabase.adminClient
      .from('channels')
      .select('*')
      .eq('channel_type', 'tiktok')
      .eq('status', 'active')
      .filter('credentials->>open_id', 'eq', openId)
      .maybeSingle();
    return (data as Channel | null) ?? null;
  }
}
