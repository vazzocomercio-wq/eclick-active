import { Injectable, Logger } from '@nestjs/common';
import type {
  ChannelContactProfile,
  ChannelCredentials,
  ChannelProvider,
  ChannelType,
  Json,
  MessageDeliveryStatus,
  SendMediaInput,
  SendMessageInput,
  SendMessageResult,
  ValidationResult,
  WebhookEvent,
} from '@eclick-active/shared';
import { decryptToken } from '../../../../modules/calendar-integrations/crypto.helper';
import type { EmailCredentials } from './email.types';

/**
 * Email channel provider — SMTP outbound + IMAP inbound.
 *
 * - sendMessage: usa nodemailer (require dinâmico pra evitar custo de
 *   import quando o canal não é usado).
 * - receiveWebhook: retorna [] sempre — email é pull-based via IMAP. O
 *   EmailPollerService roda periodicamente e converte mensagens IMAP em
 *   eventos que o EmailWebhookService processa (mesmo padrão dos outros
 *   canais inbound).
 * - validateCredentials: testa SMTP (transporter.verify) + IMAP (connect+list).
 */
@Injectable()
export class EmailProvider implements ChannelProvider {
  readonly channel_type: ChannelType = 'email';
  private readonly logger = new Logger(EmailProvider.name);

  // ──────────────────────────────────────────────────────────
  // OUTBOUND — SMTP via nodemailer
  // ──────────────────────────────────────────────────────────

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const creds = this.requireCredentials(input.channel.credentials);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require('nodemailer') as typeof import('nodemailer');

    const transporter = nodemailer.createTransport({
      host: creds.smtp_host,
      port: creds.smtp_port,
      secure: creds.smtp_port === 465, // 465=SSL, 587=STARTTLS
      auth: {
        user: creds.email,
        pass: creds.password_encrypted, // já descriptografado em requireCredentials
      },
    });

    const subject =
      this.pickString(input.content, 'subject') ??
      this.pickString(input.content, 'title') ??
      'Mensagem do CRM';
    const text =
      this.pickString(input.content, 'body') ??
      this.pickString(input.content, 'text') ??
      '';
    const html = this.pickString(input.content, 'html');
    const inReplyTo =
      input.reply_to_channel_message_id ?? this.pickString(input.content, 'in_reply_to');
    const references = this.pickArray(input.content, 'references') as string[] | undefined;

    const mail: import('nodemailer').SendMailOptions = {
      from: `"${creds.display_name}" <${creds.email}>`,
      to: input.to,
      subject,
      text: text || undefined,
      ...(html ? { html } : {}),
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(references && references.length > 0 ? { references } : {}),
      headers: {
        'X-Eclick-Active-Org': input.channel.org_id,
        'X-Eclick-Active-Channel': input.channel.id,
      },
    };

    const attachments = this.pickArray(input.content, 'attachments') as
      | Array<{ filename?: string; url?: string; content_type?: string }>
      | undefined;
    if (attachments && attachments.length > 0) {
      mail.attachments = attachments.map((a) => ({
        filename: a.filename ?? 'anexo',
        ...(a.url ? { path: a.url } : {}),
        ...(a.content_type ? { contentType: a.content_type } : {}),
      }));
    }

    try {
      const info = await transporter.sendMail(mail);
      const messageId = info.messageId ?? `<unknown-${Date.now()}@local>`;
      return {
        channel_message_id: messageId,
        status: 'sent',
      };
    } catch (err) {
      this.logger.error(
        `SMTP send falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  async sendMedia(input: SendMediaInput): Promise<SendMessageResult> {
    return this.sendMessage({
      channel: input.channel,
      to: input.to,
      content_type: 'document',
      content: {
        body: input.caption ?? '',
        subject: input.caption ?? input.filename ?? 'Anexo',
        attachments: [
          {
            filename: input.filename ?? 'anexo',
            url: input.media_url,
            content_type: input.mime_type,
          },
        ],
      } as unknown as Json,
      ...(input.reply_to_channel_message_id
        ? { reply_to_channel_message_id: input.reply_to_channel_message_id }
        : {}),
    });
  }

  // ──────────────────────────────────────────────────────────
  // INBOUND — IMAP é pull, não push. Poller faz o trabalho.
  // ──────────────────────────────────────────────────────────

  async receiveWebhook(_payload: unknown): Promise<WebhookEvent[]> {
    return [];
  }

  async getMessageStatus(_id: string): Promise<MessageDeliveryStatus> {
    // Email não tem read receipt confiável (DSN é raro). Retornamos 'sent'.
    return 'sent';
  }

  // ──────────────────────────────────────────────────────────
  // VALIDATION
  // ──────────────────────────────────────────────────────────

  async validateCredentials(creds: ChannelCredentials): Promise<ValidationResult> {
    const c = creds as unknown as EmailCredentials;
    if (!c.email || !c.password_encrypted || !c.smtp_host || !c.imap_host) {
      return {
        valid: false,
        error: 'Credenciais incompletas (email/password/smtp_host/imap_host)',
      };
    }

    let decryptedPass: string | null;
    try {
      decryptedPass = this.decryptPassword(c.password_encrypted);
    } catch (err) {
      return {
        valid: false,
        error: `Falha ao descriptografar: ${err instanceof Error ? err.message : ''}`,
      };
    }
    if (!decryptedPass) {
      return { valid: false, error: 'Senha não pôde ser lida' };
    }

    // SMTP test
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodemailer = require('nodemailer') as typeof import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: c.smtp_host,
        port: c.smtp_port,
        secure: c.smtp_port === 465,
        auth: { user: c.email, pass: decryptedPass },
      });
      await transporter.verify();
    } catch (err) {
      return {
        valid: false,
        error: `SMTP falhou: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // IMAP test
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ImapFlow } = require('imapflow') as typeof import('imapflow');
      const client = new ImapFlow({
        host: c.imap_host,
        port: c.imap_port,
        secure: c.imap_tls,
        auth: { user: c.email, pass: decryptedPass },
        logger: false,
      });
      await client.connect();
      await client.list();
      await client.logout();
    } catch (err) {
      return {
        valid: false,
        error: `IMAP falhou: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    return { valid: true, details: { smtp: 'ok', imap: 'ok' } };
  }

  async getContactProfile(externalId: string): Promise<ChannelContactProfile | null> {
    return { external_id: externalId };
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  private requireCredentials(creds: ChannelCredentials | null): EmailCredentials {
    if (!creds) throw new Error('Channel sem credentials');
    const c = creds as unknown as EmailCredentials;
    if (!c.email || !c.password_encrypted || !c.smtp_host) {
      throw new Error('Email credentials incompletas');
    }
    const decrypted = this.decryptPassword(c.password_encrypted);
    if (!decrypted) {
      throw new Error('Falha ao descriptografar senha — reconecte o canal');
    }
    return { ...c, password_encrypted: decrypted };
  }

  /** Versão pública pra services externos (poller) usarem. */
  decryptCredentials(creds: ChannelCredentials | null): EmailCredentials {
    return this.requireCredentials(creds);
  }

  private decryptPassword(encrypted: string): string | null {
    const isEncrypted = encrypted.includes(':') && encrypted.split(':').length === 3;
    if (!isEncrypted) return encrypted;
    return decryptToken(encrypted);
  }

  private pickString(obj: unknown, key: string): string | undefined {
    if (!obj || typeof obj !== 'object') return undefined;
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : undefined;
  }

  private pickArray(obj: unknown, key: string): unknown[] | undefined {
    if (!obj || typeof obj !== 'object') return undefined;
    const v = (obj as Record<string, unknown>)[key];
    return Array.isArray(v) ? v : undefined;
  }
}
