'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  copilotApi,
  type CopilotContext,
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
  /**
   * ID da row em ai_interactions associada à resposta (assistant only).
   * Vem do backend em `metadata.ai_interaction_id`. Null quando o log
   * falhou (cenário raro) — UI esconde 👍/👎 nesse caso.
   */
  ai_interaction_id?: string | null;
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

/**
 * Hook do copiloto. Aceita um `context` opcional — quando passado, todas as
 * mensagens enviadas via `send()` carregam o contexto, e o backend prepende
 * um preâmbulo "[CONTEXTO ATIVO: ...]" antes de chamar o modelo. O histórico
 * persistido em `copilot_messages` permanece com o texto original do usuário
 * (sem o preâmbulo) — `metadata.context_type` e `metadata.context_id` são
 * salvos pra trace.
 *
 * O histórico é único por usuário (não isolado por contexto) — o painel
 * abre na mesma conversa em qualquer página, mantendo continuidade.
 */
export function useCopilot(context?: CopilotContext): UseCopilotResult {
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

  // Estabiliza referência do context pra dependency do useCallback. Se o pai
  // recriar o objeto a cada render, a função `send` ainda permanece estável
  // enquanto type+id forem iguais.
  const ctxType = context?.type;
  const ctxId = context?.id;

  const send = useCallback(
    async (text: string) => {
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
        const result = await copilotApi.send(
          trimmed,
          ctxType ? { type: ctxType, ...(ctxId ? { id: ctxId } : {}) } : undefined,
        );
        setMessages((m) => [
          ...m.filter((msg) => msg.id !== tempId),
          { ...userMsg, id: `user-${result.assistant_message_id}` },
          {
            id: result.assistant_message_id,
            role: 'assistant',
            content: result.reply,
            tool_calls: result.tool_calls,
            created_at: new Date().toISOString(),
            ai_interaction_id: result.ai_interaction_id,
          },
        ]);
      } catch (err) {
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
    },
    [ctxType, ctxId],
  );

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
  const meta = rec.metadata as Record<string, unknown> | null | undefined;
  const interactionId =
    meta && typeof meta.ai_interaction_id === 'string' ? meta.ai_interaction_id : null;
  return {
    id: rec.id,
    role: rec.role,
    content: rec.content,
    tool_calls: rec.tool_calls,
    created_at: rec.created_at,
    ai_interaction_id: rec.role === 'assistant' ? interactionId : null,
  };
}
