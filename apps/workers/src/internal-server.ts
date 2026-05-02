import http from 'node:http';
import type { BaileysManager } from './whatsapp/baileys.manager.js';
import type { OutboundContent } from './whatsapp/baileys.session.js';

/**
 * HTTP server interno do worker. Existe pra a API (apps/api) conseguir
 * pedir envio de mensagens via Baileys — porque o socket WebSocket vive
 * em memória aqui, não na API.
 *
 * Endpoints:
 *   POST /internal/baileys/send
 *     Headers: X-Internal-Key: <INTERNAL_API_KEY>
 *     Body: { channel_id, to (phone), content_type, content }
 *     200 OK: { message_id }
 *     401: chave inválida
 *     400: body inválido / content_type não suportado
 *     404: canal não tem sessão (não pareado / removido)
 *     503: sessão existe mas socket ainda não está pronto
 *
 *   GET /internal/health
 *     Sem auth — usado pra healthcheck e debug.
 *     200 OK: { ok: true, sessions: <count> }
 *
 * Usa só `node:http` builtin — sem Express/Fastify pra manter o worker leve.
 */
export class InternalServer {
  private server: http.Server | null = null;

  constructor(
    private readonly manager: BaileysManager,
    private readonly options: { port: number; secret: string },
  ) {}

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[internal-server] handler erro:', err);
        if (!res.headersSent) {
          this.json(res, 500, { error: 'internal', detail: String(err) });
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.options.port, '127.0.0.1', () => {
        // eslint-disable-next-line no-console
        console.log(
          `[internal-server] ouvindo em http://127.0.0.1:${this.options.port}`,
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
    });
    this.server = null;
  }

  // ──────────────────────────────────────────────────────────
  // Handlers
  // ──────────────────────────────────────────────────────────

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    // Health (sem auth)
    if (req.method === 'GET' && url === '/internal/health') {
      this.json(res, 200, { ok: true });
      return;
    }

    // Auth check pra todo o resto
    if (!this.checkAuth(req)) {
      this.json(res, 401, { error: 'unauthorized' });
      return;
    }

    if (req.method === 'POST' && url === '/internal/baileys/send') {
      await this.handleSend(req, res);
      return;
    }

    this.json(res, 404, { error: 'not_found' });
  }

  private async handleSend(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: SendBody;
    try {
      body = await this.parseJsonBody<SendBody>(req);
    } catch (err) {
      this.json(res, 400, { error: 'invalid_json', detail: String(err) });
      return;
    }

    if (!body || typeof body.channel_id !== 'string' || typeof body.to !== 'string') {
      this.json(res, 400, { error: 'invalid_body', detail: 'channel_id e to são obrigatórios' });
      return;
    }

    const content = normalizeContent(body.content_type, body.content);
    if (!content) {
      this.json(res, 400, {
        error: 'unsupported_content',
        detail: `content_type=${body.content_type} ou shape do content inválido`,
      });
      return;
    }

    try {
      const result = await this.manager.sendMessage(body.channel_id, body.to, content);
      this.json(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Traduz erros tipados do BaileysManager em status codes apropriados
      if (message.startsWith('channel_not_found')) {
        this.json(res, 404, { error: 'channel_not_found', detail: message });
      } else if (message.startsWith('session_not_ready')) {
        this.json(res, 503, { error: 'session_not_ready', detail: message });
      } else if (message.startsWith('session_terminated')) {
        this.json(res, 503, { error: 'session_terminated', detail: message });
      } else {
        // eslint-disable-next-line no-console
        console.error('[internal-server] sendMessage falhou:', err);
        this.json(res, 500, { error: 'send_failed', detail: message });
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  private checkAuth(req: http.IncomingMessage): boolean {
    const header = req.headers['x-internal-key'];
    const provided = Array.isArray(header) ? header[0] : header;
    return typeof provided === 'string' && provided === this.options.secret;
  }

  private async parseJsonBody<T>(req: http.IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf-8');
    if (!raw) return {} as T;
    return JSON.parse(raw) as T;
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}

// ──────────────────────────────────────────────────────────
// Body shapes
// ──────────────────────────────────────────────────────────

interface SendBody {
  channel_id: string;
  /** Telefone internacional sem `+` (ex: 5571999999999) ou JID completo. */
  to: string;
  /** content_type do shared/MessageContentType — text/image/audio/video/document. */
  content_type: 'text' | 'image' | 'audio' | 'video' | 'document';
  /** Shape específico do content_type — validado por `normalizeContent`. */
  content: Record<string, unknown>;
}

function normalizeContent(
  contentType: SendBody['content_type'],
  content: Record<string, unknown> | null | undefined,
): OutboundContent | null {
  if (!content || typeof content !== 'object') return null;
  const c = content as Record<string, unknown>;

  switch (contentType) {
    case 'text':
      return typeof c.body === 'string' ? { kind: 'text', body: c.body } : null;
    case 'image':
      return typeof c.url === 'string'
        ? {
            kind: 'image',
            url: c.url,
            ...(typeof c.caption === 'string' ? { caption: c.caption } : {}),
          }
        : null;
    case 'audio':
      return typeof c.url === 'string'
        ? {
            kind: 'audio',
            url: c.url,
            ...(typeof c.mime_type === 'string' ? { mime_type: c.mime_type } : {}),
            ...(typeof c.ptt === 'boolean' ? { ptt: c.ptt } : {}),
          }
        : null;
    case 'video':
      return typeof c.url === 'string'
        ? {
            kind: 'video',
            url: c.url,
            ...(typeof c.caption === 'string' ? { caption: c.caption } : {}),
          }
        : null;
    case 'document':
      return typeof c.url === 'string'
        ? {
            kind: 'document',
            url: c.url,
            ...(typeof c.filename === 'string' ? { filename: c.filename } : {}),
            ...(typeof c.mime_type === 'string' ? { mime_type: c.mime_type } : {}),
          }
        : null;
    default:
      return null;
  }
}
