import type { UUID, ISODateString } from './common';
import type {
  NotificationType,
  NotificationSeverity,
  NotificationEntityType,
} from '../enums';

/**
 * Notificação in-app pra um agente específico.
 * Tabela: active.notifications
 */
export interface Notification {
  id: UUID;
  org_id: UUID;
  /** Destinatário (auth.users.id) — políticas RLS limitam SELECT a este usuário */
  user_id: UUID;
  title: string;
  body: string | null;
  type: NotificationType;
  severity: NotificationSeverity;
  /** Tipo da entidade referenciada (pra navegação contextual) */
  entity_type: NotificationEntityType | null;
  entity_id: UUID | null;
  /** Setado quando o usuário lê — null = não lida */
  read_at: ISODateString | null;
  /** URL/route relativa pra ação (ex: '/inbox/conv-123') */
  action_url: string | null;
  metadata: Record<string, unknown>;
  created_at: ISODateString;
}
