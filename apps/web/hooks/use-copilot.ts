'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  copilotApi,
  type CopilotMessageRecord,
  type ToolCallRecord,
} from '@/lib/api/copilot';
import { ApiError } from '@/lib/api/client';

/**
 * Estado da UI do chat. Mantém um array linear de mensagens (user + assistant)
 * + estado de "thinking" enquanto a chamada está em voo.
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls: ToolCallRecord[];
  /** ISO. Para mensagens otimistas, ts do client. */
  created_at: string;
}

interface UseCopilotResult {
  messages: ChatMessage[];
  thinking: boolean;
  loadingHistory: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
  clear: () => Promise<void>;
}

const TEMP_PREFIX = 'temp-';

export function useCopilot(): UseCopilotResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // Carrega histórico inicial
  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const history = await copilotApi.history(ctrl.signal);
        setMessages(history.map(toChatMessage));
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        // Histórico falhar não deve bloquear envio — só loga.
        setError(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro ao carregar histórico',
        );
      } finally {
        setLoadingHistory(false);
      }
    })();
    return () => ctrl.abort();
  }, []);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || inFlight.current) return;
    inFlight.current = true;
    setError(null);

    // Otimista: append user message
    const tempId = `${TEMP_PREFIX}${Date.now()}`;
    const userMsg: ChatMessage = {
      id: tempId,
      role: 'user',
      content: trimmed,
      tool_calls: [],
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    setThinking(true);

    try {
      const result = await copilotApi.send(trimmed);
      setMessages((m) => [
        // Substitui o temp pelo persistido (assumimos sucesso, server salvou)
        ...m.filter((msg) => msg.id !== tempId),
        { ...userMsg, id: `user-${result.assistant_message_id}` },
        {
          id: result.assistant_message_id,
          role: 'assistant',
          content: result.reply,
          tool_calls: result.tool_calls,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      // Mantém a user message visível, mostra erro
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao enviar mensagem',
      );
    } finally {
      inFlight.current = false;
      setThinking(false);
    }
  }, []);

  const clear = useCallback(async () => {
    setError(null);
    try {
      await copilotApi.clear();
      setMessages([]);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erro ao limpar histórico',
      );
    }
  }, []);

  return { messages, thinking, loadingHistory, error, send, clear };
}

function toChatMessage(rec: CopilotMessageRecord): ChatMessage {
  return {
    id: rec.id,
    role: rec.role,
    content: rec.content,
    tool_calls: rec.tool_calls,
    created_at: rec.created_at,
  };
}
