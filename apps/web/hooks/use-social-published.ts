'use client';

import { useEffect, useRef } from 'react';
import { getSocket } from '@/lib/realtime/socket-client';

export interface SocialPublishedPayload {
  content_id: string;
  status: 'published' | 'failed';
  any_success: boolean;
  channels: string[];
  external_post_url?: string | null;
}

/**
 * Escuta o evento `social:published` (emitido pelo publisher manual OU
 * agendado quando termina). Usado pelo editor de conteúdo pra dar refresh
 * em tempo real — sem precisar F5 quando um post agendado é publicado.
 *
 * O callback é guardado num ref pra subscrever só uma vez (evita re-subscribe
 * a cada render, mesmo que o handler seja recriado).
 */
export function useSocialPublished(
  handler: (payload: SocialPublishedPayload) => void,
): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;
      const on = (payload: SocialPublishedPayload) => ref.current(payload);
      socket.on('social:published', on);
      cleanup = () => socket.off('social:published', on);
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);
}
