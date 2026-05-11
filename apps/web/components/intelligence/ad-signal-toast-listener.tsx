'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { getSocket } from '@/lib/realtime/socket-client';

interface AdSignalNewPayload {
  signal_id: string;
  signal_type: string;
  severity: 'warning' | 'critical';
  campaign_id: string | null;
  campaign_name?: string | null;
  metric_key: string | null;
  display_message?: string;
}

/**
 * Listener global do dashboard pra toast in-app de sinais novos do Active
 * Intelligence. Plugado no DashboardLayout.
 *
 * Comportamento:
 *   - severity=critical → toast.error, fica até user dismissar (duration: Infinity)
 *   - severity=warning → toast.warning, auto-dismiss em 30s
 *   - clica no toast → vai pra /intelligence (com tab `signals` aberta)
 *
 * Dedup em memória por signal_id (Set) — mesmo signal pode chegar 2x se
 * socket re-conectar antes do server perceber.
 */
export function AdSignalToastListener() {
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;

      const onSignal = (payload: AdSignalNewPayload) => {
        if (seenRef.current.has(payload.signal_id)) return;
        seenRef.current.add(payload.signal_id);

        // GC simples — Set não cresce sem limite (sessions longas)
        if (seenRef.current.size > 500) {
          seenRef.current = new Set(
            Array.from(seenRef.current).slice(-200),
          );
        }

        const message = payload.display_message ?? formatFallback(payload);
        const description = payload.severity === 'critical' ? '🚨 Crítico' : '⚠️ Aviso';
        const fn = payload.severity === 'critical' ? toast.error : toast.warning;

        fn(message, {
          description,
          duration: payload.severity === 'critical' ? Infinity : 30_000,
          action: {
            label: 'Ver',
            onClick: () => {
              // Sonner não tem router built-in — usamos location pra não importar Next router
              // no componente que monta no layout (evita refresh-on-navigation issue)
              window.location.href = '/intelligence';
            },
          },
          id: `ad-signal-${payload.signal_id}`,
        });
      };

      socket.on('ad-signal:new', onSignal);
      cleanup = () => {
        socket.off('ad-signal:new', onSignal);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return null;
}

function formatFallback(p: AdSignalNewPayload): string {
  const where = p.campaign_name ? `em "${p.campaign_name}"` : '';
  return `Novo sinal: ${p.signal_type} ${where}`.trim();
}
