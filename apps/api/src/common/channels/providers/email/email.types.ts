/**
 * Tipos do canal Email (SMTP + IMAP).
 */

export interface EmailCredentials {
  email: string;
  /** Senha criptografada AES-256-GCM via crypto.helper */
  password_encrypted: string;
  display_name: string;
  smtp_host: string;
  smtp_port: number;
  imap_host: string;
  imap_port: number;
  imap_tls: boolean;
  /** Pasta IMAP — default INBOX */
  folder?: string;
  /** Quando true, envolve emails enviados num template HTML estilizado */
  use_template?: boolean;
  /** Override do nome de exibição da org no template */
  org_display_name?: string;
}

export type EmailProviderPreset = 'gmail' | 'outlook' | 'yahoo' | 'custom';

export interface EmailMessageMetadata {
  message_id: string;
  in_reply_to: string | null;
  references: string[];
  subject: string;
  from: string;
  from_name: string | null;
  to: string[];
  cc: string[];
  has_attachments: boolean;
  attachments: Array<{
    filename: string;
    content_type: string;
    size: number;
    url?: string;
  }>;
  date: string; // ISO
}

/**
 * Resultado interno do parser IMAP — usado pelo poller pra alimentar
 * o pipeline de webhook normalmente.
 */
export interface ParsedEmail {
  uid: number;
  message_id: string;
  in_reply_to: string | null;
  references: string[];
  subject: string;
  from: { email: string; name: string | null };
  to: string[];
  cc: string[];
  date: Date;
  text: string;
  html: string | null;
  attachments: Array<{
    filename: string;
    content_type: string;
    size: number;
  }>;
}
