import type { ISODateString, UUID } from './common';

/**
 * Thread de email — vincula Message-ID raiz a uma conversation. Permite
 * que replies do cliente (que vêm com In-Reply-To/References apontando
 * pro Message-ID original) caiam na mesma conversa.
 *
 * Tabela: active.email_threads
 */
export interface EmailThread {
  id: UUID;
  org_id: UUID;
  channel_id: UUID;
  conversation_id: UUID | null;
  /** Message-ID do primeiro email da sequência (raiz). */
  thread_id: string;
  subject: string | null;
  /** Último Message-ID — usado pra In-Reply-To no próximo envio. */
  last_message_id: string | null;
  message_count: number;
  created_at: ISODateString;
  updated_at: ISODateString;
}
