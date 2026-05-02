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
    | 'conversation:updated';
  payload: unknown;
}

export async function broadcastRealtime(input: BroadcastInput): Promise<boolean> {
  const url = process.env.INTERNAL_API_URL;
  const key = process.env.INTERNAL_API_KEY;
  if (!url || !key) {
    // eslint-disable-next-line no-console
    console.warn('[internal-api] INTERNAL_API_URL/KEY ausentes — broadcast descartado');
    return false;
  }

  try {
    const res = await fetch(`${url}/internal/realtime`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': key,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[internal-api] broadcast falhou: ${res.status} ${res.statusText}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[internal-api] broadcast erro: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
