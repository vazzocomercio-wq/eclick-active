/**
 * Cliente HTTP minimal pro endpoint POST /internal/realtime do API.
 * Usado pelo worker pra emitir broadcasts socket.io (whatsapp:qr,
 * whatsapp:connected, whatsapp:disconnected) sem precisar manter
 * conexão socket.io própria.
 *
 * Falhas de rede aqui são best-effort: logamos e seguimos a vida.
 * O frontend pode reconciliar via fetch ao reconectar.
 */

interface BroadcastInput {
  org_id: string;
  event:
    | 'whatsapp:qr'
    | 'whatsapp:connected'
    | 'whatsapp:disconnected'
    | 'message:new'
    | 'message:updated'
    | 'conversation:updated';
  payload: unknown;
}

interface InboundProcessedInput {
  org_id: string;
  conversation_id: string;
  contact_id: string;
  message_id: string;
  channel_id: string;
  channel_type: string;
  message_text: string;
}

export async function broadcastRealtime(input: BroadcastInput): Promise<boolean> {
  const url = process.env.INTERNAL_API_URL;
  const key = process.env.INTERNAL_API_KEY;
  if (!url || !key) {
    // eslint-disable-next-line no-console
    console.warn(
      `[internal-api] env ausente: INTERNAL_API_URL=${!!url} INTERNAL_API_KEY=${!!key} — broadcast event=${input.event} descartado`,
    );
    return false;
  }

  try {
    // eslint-disable-next-line no-console
    console.log(
      `[internal-api] → POST ${url}/internal/realtime event=${input.event} org=${input.org_id}`,
    );
    const res = await fetch(`${url}/internal/realtime`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': key,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.warn(
        `[internal-api] broadcast event=${input.event} falhou: ${res.status} ${res.statusText} body=${body.slice(0, 200)}`,
      );
      return false;
    }
    // eslint-disable-next-line no-console
    console.log(`[internal-api] ✓ broadcast event=${input.event} OK`);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[internal-api] broadcast event=${input.event} erro: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Avisa a api que uma mensagem inbound foi persistida pelo worker.
 * A api dispara: ai.processInbound (classify+suggest+concierge) e
 * automations.checkTriggers (trigger=message_received).
 *
 * Best-effort: erro aqui não bloqueia o processamento da próxima mensagem.
 */
export async function notifyInboundProcessed(
  input: InboundProcessedInput,
): Promise<boolean> {
  const url = process.env.INTERNAL_API_URL;
  const key = process.env.INTERNAL_API_KEY;
  if (!url || !key) {
    // eslint-disable-next-line no-console
    console.warn(
      `[internal-api] env ausente: URL=${!!url} KEY=${!!key} — inbound-processed descartado`,
    );
    return false;
  }
  try {
    // eslint-disable-next-line no-console
    console.log(
      `[internal-api] → POST ${url}/internal/inbound-processed conv=${input.conversation_id} msg=${input.message_id}`,
    );
    const res = await fetch(`${url}/internal/inbound-processed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': key,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.warn(
        `[internal-api] inbound-processed falhou: ${res.status} ${res.statusText} body=${body.slice(0, 200)}`,
      );
      return false;
    }
    // eslint-disable-next-line no-console
    console.log('[internal-api] ✓ inbound-processed OK');
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[internal-api] inbound-processed erro: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
