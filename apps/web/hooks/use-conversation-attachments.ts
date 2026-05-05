'use client';

import { useEffect, useState } from 'react';
import {
  attachmentsApi,
  type ConversationAttachment,
} from '@/lib/api/attachments';

/**
 * Carrega attachments de uma conversa e expõe um Map<messageId, attachment[]>
 * pra UI renderizar mídia rica + summary IA por mensagem.
 *
 * Refetch quando conversationId mudar OU quando refreshKey for incrementada
 * (use pra invalidar quando attachment processed event chegar via socket).
 */
export function useConversationAttachments(
  conversationId: string | null,
  refreshKey = 0,
): Map<string, ConversationAttachment[]> {
  const [byMessage, setByMessage] = useState<Map<string, ConversationAttachment[]>>(
    new Map(),
  );

  useEffect(() => {
    if (!conversationId) {
      setByMessage(new Map());
      return;
    }
    const ctrl = new AbortController();
    attachmentsApi
      .forConversation(conversationId, ctrl.signal)
      .then((rows) => {
        const m = new Map<string, ConversationAttachment[]>();
        for (const r of rows) {
          const list = m.get(r.message_id) ?? [];
          list.push(r);
          m.set(r.message_id, list);
        }
        setByMessage(m);
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        // silently fail — UI degrada graciosamente sem media
      });
    return () => ctrl.abort();
  }, [conversationId, refreshKey]);

  return byMessage;
}
