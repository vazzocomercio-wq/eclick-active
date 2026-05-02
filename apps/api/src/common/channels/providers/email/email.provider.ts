import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import type {
  ChannelContactProfile,
  ChannelCredentials,
  ChannelProvider,
  ChannelType,
  MessageDeliveryStatus,
  SendMediaInput,
  SendMessageInput,
  SendMessageResult,
  ValidationResult,
  WebhookEvent,
} from '@eclick-active/shared';

/**
 * Email channel provider — STUB MVP.
 *
 * O envio real via SMTP (nodemailer) ou provider transacional (Mailgun,
 * SendGrid, AWS SES) fica pra fase posterior porque exige:
 *   - Configuração de credenciais SMTP por org (cifradas)
 *   - DKIM/SPF/DMARC pra deliverability
 *   - Webhook de bounce/complaint pra atualizar status
 *
 * Por enquanto:
 *   - `sendMessage` / `sendMedia` lança `NotImplementedException`
 *   - `validateCredentials` valida shape mínimo (smtp_host + smtp_user + from)
 *   - `receiveWebhook` retorna [] (recebimento via Mailgun parser fica TODO)
 *
 * Está registrado no ChannelDispatcher pra que `channel_type='email'` seja
 * reconhecido. Automações com action `send_email` chamam o `EmailService`
 * dedicado (que loga "stub: email não enviado" até a integração SMTP real).
 */
@Injectable()
export class EmailProvider implements ChannelProvider {
  readonly channel_type: ChannelType = 'email';

  private readonly logger = new Logger(EmailProvider.name);

  async sendMessage(_input: SendMessageInput): Promise<SendMessageResult> {
    throw new NotImplementedException(
      'Email outbound: SMTP integration ainda não implementada (TODO PARTE 3 final).',
    );
  }

  async sendMedia(_input: SendMediaInput): Promise<SendMessageResult> {
    throw new NotImplementedException('Email sendMedia: TODO');
  }

  async receiveWebhook(_payload: unknown): Promise<WebhookEvent[]> {
    // Mailgun/SendGrid parsing fica como TODO
    return [];
  }

  async getMessageStatus(_id: string): Promise<MessageDeliveryStatus> {
    // Email status chega via webhook do provider (delivered, bounced, etc.)
    return 'sent';
  }

  async validateCredentials(creds: ChannelCredentials): Promise<ValidationResult> {
    const c = creds as Partial<EmailCredentials>;
    if (!c.smtp_host || !c.smtp_user || !c.from) {
      return {
        valid: false,
        error: 'Email channel exige smtp_host, smtp_user e from no credentials',
      };
    }
    return { valid: true, details: { smtp_host: c.smtp_host } };
  }

  async getContactProfile(_externalId: string): Promise<ChannelContactProfile | null> {
    return null;
  }
}

interface EmailCredentials {
  smtp_host: string;
  smtp_port?: number;
  smtp_user: string;
  smtp_pass?: string;
  /** Endereço "from:" usado nos envios (ex: "vendas@empresa.com.br"). */
  from: string;
}
