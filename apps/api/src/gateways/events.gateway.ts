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
  Deal,
  DealActivity,
  Message,
  Notification,
  UUID,
} from '@eclick-active/shared';
import { AuthService } from '../common/auth/auth.service';
import type { AuthUser } from '../common/auth/auth.types';
import { resolveCorsOrigins } from '../common/cors';

// ──────────────────────────────────────────────────────────
// Event payload contracts (server → client)
// ──────────────────────────────────────────────────────────

export interface MessageNewPayload {
  conversation_id: UUID;
  message: Message;
}

export interface MessageUpdatedPayload {
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
  /** ID da row em ai_interactions — pra UI permitir feedback 👍/👎 */
  ai_interaction_id?: UUID;
}

export interface DealCreatedPayload {
  deal: Deal;
}

export interface DealMovedPayload {
  deal_id: UUID;
  from_stage_id: UUID;
  to_stage_id: UUID;
  position: number;
  /** Setado quando o destino é stage is_won/is_lost */
  closed_state?: 'won' | 'lost' | null;
  /** Quem moveu — frontend usa pra evitar toastar próprias ações. */
  moved_by_user_id?: UUID;
  /** Título do deal — pra UX dos toasts ("Carlos moveu 'X' pra Negociação"). */
  deal_title?: string;
  /** Nome do stage destino — idem. */
  to_stage_name?: string;
}

export interface DealUpdatedPayload {
  deal: Deal;
}

export interface DealActivityAddedPayload {
  deal_id: UUID;
  activity: DealActivity;
}

// ── Baileys / WhatsApp Free ──
// Worker (apps/workers) emite esses eventos via POST /internal/realtime
// quando a sessão Baileys de um canal muda de estado.

export interface WhatsappQrPayload {
  channel_id: UUID;
  /** QR code raw (string que vem do Baileys, frontend renderiza como QR) */
  qr: string;
}

export interface WhatsappConnectedPayload {
  channel_id: UUID;
  /** Número internacional pareado (ex: '5571999999999') */
  phone_number: string;
  /** pushName do perfil WhatsApp */
  display_name?: string;
}

export interface WhatsappDisconnectedPayload {
  channel_id: UUID;
  /** Razão (Baileys DisconnectReason) ou 'logged_out' */
  reason: string;
  /** Se true, precisa reescanear QR */
  needs_reauth: boolean;
}

export interface AppointmentReminderPayload {
  appointment_id: string;
  contact_id: string | null;
  contact_name?: string | null;
  agent_id: string | null;
  title: string;
  start_time?: string;
}

export interface AppointmentNoShowPayload {
  appointment_id: string;
  contact_id: string | null;
  agent_id: string | null;
  title: string;
}

export interface SchedulingSuggestionPayload {
  conversation_id: string;
  slots: Array<{ start_time: string; end_time: string; agent_id: string; agent_name: string | null }>;
  appointment_type_guess: string | null;
}

export type EventName =
  | 'message:new'
  | 'message:updated'
  | 'conversation:updated'
  | 'ai:suggestion'
  | 'ai:scheduling-suggestion'
  | 'notification'
  | 'deal:created'
  | 'deal:moved'
  | 'deal:updated'
  | 'deal:activity_added'
  | 'whatsapp:qr'
  | 'whatsapp:connected'
  | 'whatsapp:disconnected'
  | 'appointment:reminder-24h'
  | 'appointment:reminder-1h'
  | 'appointment:no-show';

export interface EventPayloadMap {
  'message:new': MessageNewPayload;
  'message:updated': MessageUpdatedPayload;
  'conversation:updated': ConversationUpdatedPayload;
  'ai:suggestion': AISuggestionPayload;
  'ai:scheduling-suggestion': SchedulingSuggestionPayload;
  notification: Notification;
  'deal:created': DealCreatedPayload;
  'deal:moved': DealMovedPayload;
  'deal:updated': DealUpdatedPayload;
  'deal:activity_added': DealActivityAddedPayload;
  'whatsapp:qr': WhatsappQrPayload;
  'whatsapp:connected': WhatsappConnectedPayload;
  'whatsapp:disconnected': WhatsappDisconnectedPayload;
  'appointment:reminder-24h': AppointmentReminderPayload;
  'appointment:reminder-1h': AppointmentReminderPayload;
  'appointment:no-show': AppointmentNoShowPayload;
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
    origin: resolveCorsOrigins(),
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
