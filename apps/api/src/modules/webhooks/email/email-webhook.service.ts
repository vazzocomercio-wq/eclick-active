import { Injectable, Logger } from '@nestjs/common';
import type {
  Channel,
  Json,
  Message,
  MessageContent,
  MessageContentType,
} from '@eclick-active/shared';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type { ParsedEmail } from '../../../common/channels/providers/email/email.types';
import { ContactsService } from '../../contacts/contacts.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { EventsGateway } from '../../../gateways/events.gateway';
import { AiService } from '../../ai/ai.service';
import { AutomationsService } from '../../automations/automations.service';
import { AutoLeadService } from '../auto-lead.service';

/**
 * Processa email recebido (alimentado pelo EmailPollerService) seguindo
 * a mesma arquitetura do ZapiWebhookService:
 *   1. Resolve thread (ou cria) via In-Reply-To/References
 *   2. findOrCreateContact por email do sender
 *   3. findOrCreateConversation (vinculada à thread)
 *   4. Persiste mensagem com metadata completo
 *   5. Atualiza thread.last_message_id + message_count
 *   6. Emit message:new + conversation:updated
 *   7. Fire-and-forget: AI.processInbound + auto-lead + automations
 */
@Injectable()
export class EmailWebhookService {
  private readonly logger = new Logger(EmailWebhookService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly contacts: ContactsService,
    private readonly conversations: ConversationsService,
    private readonly events: EventsGateway,
    private readonly ai: AiService,
    private readonly automations: AutomationsService,
    private readonly autoLead: AutoLeadService,
  ) {}

  async handleParsed(channel: Channel, parsed: ParsedEmail): Promise<void> {
    if (!parsed.from.email) {
      this.logger.warn(`Email sem from — ignorado (uid=${parsed.uid})`);
      return;
    }

    // 1. Idempotência por message_id
    const existing = await this.supabase.adminClient
      .from('messages')
      .select('id')
      .eq('org_id', channel.org_id)
      .eq('channel_message_id', parsed.message_id)
      .maybeSingle();
    if ((existing.data as { id: string } | null)?.id) return;

    // 2. Resolve thread
    const { threadId, conversationId: existingConvId } = await this.resolveThread(
      channel,
      parsed,
    );

    // 3. findOrCreateContact por email
    const contact = await this.contacts.findOrCreateByEmail(
      channel.org_id,
      parsed.from.email,
      parsed.from.name ?? undefined,
    );

    // 4. Conversation: usa existente da thread, ou cria nova
    let conversationId: string;
    if (existingConvId) {
      conversationId = existingConvId;
    } else {
      const conv = await this.conversations.findOrCreate(
        channel.org_id,
        contact.id,
        channel.id,
        'email',
      );
      conversationId = conv.id;
    }

    // 5. Constrói content + metadata
    const text = parsed.text || this.stripHtml(parsed.html ?? '');
    const subject = parsed.subject;
    const content: MessageContent = {
      body: text,
      subject,
      ...(parsed.html ? { html: parsed.html } : {}),
    } as unknown as MessageContent;

    const metadata = {
      email: {
        message_id: parsed.message_id,
        in_reply_to: parsed.in_reply_to,
        references: parsed.references,
        subject: parsed.subject,
        from: parsed.from.email,
        from_name: parsed.from.name,
        to: parsed.to,
        cc: parsed.cc,
        date: parsed.date.toISOString(),
        has_attachments: parsed.attachments.length > 0,
        attachments: parsed.attachments,
      },
    };

    // 6. Persiste
    const contentType: MessageContentType =
      parsed.attachments.length > 0 ? 'document' : 'text';

    const { data: insertedMessage, error: insertErr } = await this.supabase.adminClient
      .from('messages')
      .insert({
        org_id: channel.org_id,
        conversation_id: conversationId,
        channel_id: channel.id,
        channel_message_id: parsed.message_id,
        direction: 'inbound',
        content_type: contentType,
        content: content as unknown as Json,
        plain_text: text.slice(0, 5000),
        sender_type: 'contact',
        status: 'delivered',
        created_at: parsed.date.toISOString(),
        metadata: metadata as unknown as Json,
      })
      .select('*')
      .single();

    if (insertErr || !insertedMessage) {
      this.logger.error(`Persist falhou: ${insertErr?.message}`);
      return;
    }

    const message = insertedMessage as Message;

    // 7. Atualiza/cria thread
    await this.upsertThread(channel, parsed, threadId, conversationId);

    // 8. Eventos WebSocket
    try {
      this.events.emitToOrg(channel.org_id, 'message:new', {
        conversation_id: conversationId,
        message,
      });
      const updatedConv = await this.conversations.findByIdRaw(channel.org_id, conversationId);
      if (updatedConv) {
        this.events.emitToOrg(channel.org_id, 'conversation:updated', {
          conversation: updatedConv,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Event emit falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 9. Fire-and-forget AI + auto-lead + automations
    void this.ai
      .processInbound(channel.org_id, conversationId, message.id)
      .catch((err) => {
        this.logger.warn(
          `AI processInbound falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    void this.autoLead
      .handleNewContact({
        orgId: channel.org_id,
        contactId: contact.id,
        conversationId,
      })
      .catch(() => {});

    void this.automations
      .checkTriggers({
        event: 'message_received',
        org_id: channel.org_id,
        conversation_id: conversationId,
        contact_id: contact.id,
        channel_id: channel.id,
        channel_type: 'email',
        message_id: message.id,
        message_text: text,
        ai_intent: null,
      })
      .catch(() => {});
  }

  // ──────────────────────────────────────────────────────────
  // Thread resolution
  // ──────────────────────────────────────────────────────────

  /**
   * Procura thread existente por references ou in_reply_to. Retorna
   * thread_id (raiz) + conversation_id se já existe. Senão, retorna
   * thread_id novo (= message_id atual) e conversation_id null.
   */
  private async resolveThread(
    channel: Channel,
    parsed: ParsedEmail,
  ): Promise<{ threadId: string; conversationId: string | null }> {
    // Coleta candidatos: in_reply_to + references
    const candidates: string[] = [];
    if (parsed.in_reply_to) candidates.push(parsed.in_reply_to);
    candidates.push(...parsed.references);

    if (candidates.length > 0) {
      // Procura threads cujo last_message_id ou thread_id bate com algum candidato
      const { data } = await this.supabase.adminClient
        .from('email_threads')
        .select('thread_id, conversation_id')
        .eq('org_id', channel.org_id)
        .eq('channel_id', channel.id)
        .or(
          `thread_id.in.(${candidates.map((c) => `"${c.replace(/"/g, '\\"')}"`).join(',')}),last_message_id.in.(${candidates.map((c) => `"${c.replace(/"/g, '\\"')}"`).join(',')})`,
        )
        .limit(1)
        .maybeSingle();

      const row = data as { thread_id: string; conversation_id: string | null } | null;
      if (row) {
        return { threadId: row.thread_id, conversationId: row.conversation_id };
      }
    }

    // Thread nova — usa message_id atual como raiz
    return { threadId: parsed.message_id, conversationId: null };
  }

  /**
   * Cria ou atualiza email_thread. Atualiza last_message_id pra threading
   * de replies futuros.
   */
  private async upsertThread(
    channel: Channel,
    parsed: ParsedEmail,
    threadId: string,
    conversationId: string,
  ): Promise<void> {
    const { data: existing } = await this.supabase.adminClient
      .from('email_threads')
      .select('id, message_count')
      .eq('org_id', channel.org_id)
      .eq('channel_id', channel.id)
      .eq('thread_id', threadId)
      .maybeSingle();

    if ((existing as { id: string; message_count: number } | null)?.id) {
      await this.supabase.adminClient
        .from('email_threads')
        .update({
          last_message_id: parsed.message_id,
          message_count: ((existing as { message_count: number }).message_count ?? 0) + 1,
          conversation_id: conversationId,
        })
        .eq('id', (existing as { id: string }).id);
    } else {
      await this.supabase.adminClient.from('email_threads').insert({
        org_id: channel.org_id,
        channel_id: channel.id,
        conversation_id: conversationId,
        thread_id: threadId,
        subject: parsed.subject,
        last_message_id: parsed.message_id,
        message_count: 1,
      });
    }
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }
}
