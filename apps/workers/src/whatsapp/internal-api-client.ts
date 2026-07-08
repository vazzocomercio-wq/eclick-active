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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * POST interno com retry + backoff (best-effort, mas resiliente).
 *
 * MOTIVAÇÃO: durante um deploy da API, ela fica indisponível por alguns
 * segundos. Sem retry, um POST /internal/inbound-processed emitido nesse
 * intervalo era perdido pra sempre — a IA e as automations NÃO rodavam pra
 * aquela mensagem. Aqui tentamos algumas vezes com backoff pra atravessar a
 * janela de deploy. 5xx e erros de rede são retriáveis; 4xx (exceto 429) não
 * (erro do nosso lado, retry não ajuda). Continua best-effort: se esgotar as
 * tentativas, loga e desiste sem quebrar o processamento da próxima msg.
 */
async function postInternalWithRetry(
  path: string,
  input: unknown,
  label: string,
): Promise<boolean> {
  const url = process.env.INTERNAL_API_URL;
  const key = process.env.INTERNAL_API_KEY;
  if (!url || !key) {
    // eslint-disable-next-line no-console
    console.warn(
      `[internal-api] env ausente: URL=${!!url} KEY=${!!key} — ${label} descartado`,
    );
    return false;
  }

  const maxAttempts = Number(process.env.INTERNAL_API_MAX_ATTEMPTS ?? 4);
  let lastDetail = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': key,
        },
        body: JSON.stringify(input),
      });
      if (res.ok) {
        // eslint-disable-next-line no-console
        console.log(`[internal-api] ✓ ${label} OK${attempt > 1 ? ` (tentativa ${attempt})` : ''}`);
        return true;
      }
      const body = await res.text().catch(() => '');
      lastDetail = `${res.status} ${res.statusText} ${body.slice(0, 160)}`;
      // 4xx (menos 429) não é retriável — problema no request, não transitório.
      const retriable = res.status >= 500 || res.status === 429;
      if (!retriable) {
        // eslint-disable-next-line no-console
        console.warn(`[internal-api] ${label} falhou (não-retriável): ${lastDetail}`);
        return false;
      }
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
    }

    if (attempt < maxAttempts) {
      // Backoff exponencial + jitter: ~500ms, 1s, 2s…
      const delay = Math.min(500 * 2 ** (attempt - 1), 5000) + Math.floor(Math.random() * 250);
      // eslint-disable-next-line no-console
      console.warn(
        `[internal-api] ${label} tentativa ${attempt}/${maxAttempts} falhou (${lastDetail}) — retry em ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[internal-api] ${label} desistiu após ${maxAttempts} tentativas: ${lastDetail}`,
  );
  return false;
}

export async function broadcastRealtime(input: BroadcastInput): Promise<boolean> {
  return postInternalWithRetry('/internal/realtime', input, `broadcast event=${input.event}`);
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
  return postInternalWithRetry(
    '/internal/inbound-processed',
    input,
    `inbound-processed conv=${input.conversation_id} msg=${input.message_id}`,
  );
}
