import type {
  Json,
  Message,
  MessageContentType,
  SendMessageDto,
} from '@eclick-active/shared';
import { api } from './client';

export interface CursorPaginatedResult<T> {
  data: T[];
  /** ISO 8601 — passe no próximo request como `?cursor=...`. null = fim. */
  nextCursor: string | null;
}

export const messagesApi = {
  getByConversation(
    conversationId: string,
    cursor?: string,
    limit = 50,
    signal?: AbortSignal,
  ) {
    return api.get<CursorPaginatedResult<Message>>(
      `/conversations/${conversationId}/messages`,
      {
        query: { cursor, limit },
        signal,
      },
    );
  },

  send(conversationId: string, dto: SendMessageDto) {
    return api.post<Message>(`/conversations/${conversationId}/messages`, dto);
  },

  /** Atalho conveniente pra enviar texto. */
  sendText(conversationId: string, body: string, isInternalNote = false) {
    const dto: SendMessageDto = {
      content_type: 'text',
      content: { body } as unknown as Json,
      is_internal_note: isInternalNote,
    };
    return this.send(conversationId, dto);
  },

  /** Envia um produto do catálogo como image + caption.
   *
   *  Baileys (provider WhatsApp atual do Active) não suporta a mensagem
   *  interactive 'product' da Cloud API. Por isso mandamos a primeira
   *  foto do produto como image + caption com nome, preço, link e
   *  observação opcional do vendedor. O channel adapter envia o image
   *  normal — sem suporte adicional necessário.
   */
  sendProduct(
    conversationId: string,
    args: {
      productId: string;
      name:      string;
      price:     number;
      imageUrl?: string | null;
      sku?:      string | null;
      link?:     string | null;
      extra?:    string;
    },
  ) {
    const priceBr = args.price.toLocaleString('pt-BR', {
      style: 'currency', currency: 'BRL',
    });
    const lines = [`*${args.name}*`, priceBr];
    if (args.sku)   lines.push(`SKU: ${args.sku}`);
    if (args.link)  lines.push(args.link);
    if (args.extra) { lines.push(''); lines.push(args.extra); }
    const caption = lines.join('\n');

    const dto: SendMessageDto = args.imageUrl
      ? {
          content_type: 'image',
          content: { url: args.imageUrl, caption } as unknown as Json,
        }
      : {
          // Fallback: sem foto manda texto formatado
          content_type: 'text',
          content: { body: caption } as unknown as Json,
        };
    return this.send(conversationId, dto);
  },
};

export type { Message, MessageContentType, SendMessageDto };
