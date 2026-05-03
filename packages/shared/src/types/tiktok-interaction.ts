import type { ISODateString, UUID } from './common';

export type TikTokInteractionType =
  | 'comment'
  | 'mention'
  | 'follow'
  | 'like'
  | 'share'
  | 'dm';

/**
 * Interação do TikTok — comentários em vídeos do business, follows,
 * menções, etc. Cada interação pode virar uma mensagem dentro de uma
 * conversation (no caso de comments/dms) ou só uma notificação no
 * dashboard (likes/follows).
 *
 * Tabela: active.tiktok_interactions
 */
export interface TikTokInteraction {
  id: UUID;
  org_id: UUID;
  channel_id: UUID;
  contact_id: UUID | null;
  conversation_id: UUID | null;
  interaction_type: TikTokInteractionType;
  video_id: string | null;
  video_url: string | null;
  comment_id: string | null;
  parent_comment_id: string | null;
  content: string | null;
  username: string | null;
  user_avatar_url: string | null;
  /** open_id do TikTok (escopado por app — não é o uid global público) */
  external_user_id: string | null;
  replied: boolean;
  reply_content: string | null;
  /** Classificação IA: 'lead' | 'question' | 'praise' | 'complaint' | 'spam' */
  ai_intent: string | null;
  metadata: Record<string, unknown>;
  created_at: ISODateString;
}
