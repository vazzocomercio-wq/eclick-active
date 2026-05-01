import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type {
  Conversation,
  Message,
  Notification,
  UUID,
} from '@eclick-active/shared';
import { AuthService } from '../common/auth/auth.service';
import type { AuthUser } from '../common/auth/auth.types';

// ──────────────────────────────────────────────────────────
// Event payload contracts (server → client)
// ──────────────────────────────────────────────────────────

export interface MessageNewPayload {
  conversation_id: UUID;
  message: Message;
}

export interface ConversationUpdatedPayload {
  conversation: Conversation;
}

export interface AISuggestionPayload {
  conversation_id: UUID;
  suggestion: string;
  /** Confidence 0..1 da IA */
  confidence?: number;
}

export type EventName =
  | 'message:new'
  | 'conversation:updated'
  | 'ai:suggestion'
  | 'notification';

export interface EventPayloadMap {
  'message:new': MessageNewPayload;
  'conversation:updated': ConversationUpdatedPayload;
  'ai:suggestion': AISuggestionPayload;
  notification: Notification;
}

const ROOM_PREFIX = 'org';

/**
 * Gateway WebSocket pra eventos custom do CRM. O frontend conecta ao
 * namespace `/events` com `{ auth: { token: <supabase JWT> } }`. Após
 * validar, o socket é colocado num room `org:<org_id>` — `emitToOrg`
 * publica só pra clientes daquela org (isolamento multi-tenant).
 *
 * Eventos vindos por aqui são CUSTOM: ai:suggestion, ai:audit, etc.
 * Mudanças puras de row em `conversations` e `messages` o frontend
 * pode escutar direto via Supabase Realtime (mais barato e sem nosso
 * server no caminho).
 */
@WebSocketGateway({
  namespace: '/events',
  cors: {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly auth: AuthService) {}

  // ──────────────────────────────────────────────────────────
  // Connection lifecycle
  // ──────────────────────────────────────────────────────────

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      this.logger.debug(`Socket ${client.id} rejected: no token`);
      client.emit('auth:error', { message: 'Missing auth.token' });
      client.disconnect(true);
      return;
    }

    const user = await this.auth.resolveUser(token);
    if (!user) {
      this.logger.debug(`Socket ${client.id} rejected: invalid token or no org`);
      client.emit('auth:error', { message: 'Invalid token or no org membership' });
      client.disconnect(true);
      return;
    }

    // Anexa o user no socket pra reuso (ex: filtros em events futuros)
    (client.data as { user?: AuthUser }).user = user;

    const room = `${ROOM_PREFIX}:${user.org_id}`;
    await client.join(room);

    client.emit('auth:ok', { user_id: user.id, org_id: user.org_id });
    this.logger.log(`Socket ${client.id} joined ${room} (user=${user.id})`);
  }

  handleDisconnect(client: Socket): void {
    const user = (client.data as { user?: AuthUser }).user;
    this.logger.debug(
      `Socket ${client.id} disconnected${user ? ` (user=${user.id})` : ''}`,
    );
  }

  // ──────────────────────────────────────────────────────────
  // Public emit API
  // ──────────────────────────────────────────────────────────

  /**
   * Emite um evento pra todos os clientes de uma organização.
   * Type-safe: o payload é checado contra `EventPayloadMap`.
   */
  emitToOrg<E extends EventName>(
    orgId: string,
    event: E,
    payload: EventPayloadMap[E],
  ): void {
    if (!this.server) {
      this.logger.warn(`Server not ready, dropping ${event} for org=${orgId}`);
      return;
    }
    this.server.to(`${ROOM_PREFIX}:${orgId}`).emit(event, payload);
  }

  /**
   * Emite só pra um usuário específico (ex: notificações pessoais).
   * Procura todos os sockets do usuário e emite individualmente — não
   * usa room dedicado pra economizar Redis-adapter overhead.
   */
  async emitToUser<E extends EventName>(
    orgId: string,
    userId: string,
    event: E,
    payload: EventPayloadMap[E],
  ): Promise<void> {
    if (!this.server) return;
    const sockets = await this.server.in(`${ROOM_PREFIX}:${orgId}`).fetchSockets();
    for (const s of sockets) {
      const u = (s.data as { user?: AuthUser }).user;
      if (u?.id === userId) {
        s.emit(event, payload);
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────

  /**
   * Aceita o token via `auth.token` (recomendado pelo socket.io v4) ou
   * via header Authorization (compat com clients que não usam o auth field).
   */
  private extractToken(client: Socket): string | null {
    const authObj = client.handshake.auth as { token?: string } | undefined;
    if (typeof authObj?.token === 'string' && authObj.token.length > 0) {
      return authObj.token;
    }
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string') {
      const m = /^Bearer (.+)$/.exec(header);
      if (m) return m[1] as string;
    }
    return null;
  }
}
