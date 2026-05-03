/**
 * Tipos do canal TikTok via TikTok for Developers (OAuth) +
 * Content Posting / Display API.
 *
 * Limitação atual (2026): TikTok Business Messages (DM) está em beta
 * fechado. Implementação cobre Cenário A (comments/follows via webhook)
 * e deixa stubs pra Cenário B (DMs) quando liberar.
 *
 * Doc: https://developers.tiktok.com/doc/login-kit-overview
 */

export interface TikTokCredentials {
  /** open_id do user TikTok (escopado por app — único) */
  open_id: string;
  /** Token criptografado AES-256-GCM */
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  /** ISO de expiração do access_token (24h após emissão) */
  token_expires_at: string;
  username: string;
  display_name: string;
  /** URL do avatar do user TikTok (pra exibir no card do canal) */
  avatar_url?: string;
}

export interface TikTokTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
  token_type: string;
}

export interface TikTokUserInfo {
  open_id: string;
  union_id: string;
  avatar_url: string;
  avatar_url_100: string;
  display_name: string;
  username: string;
  profile_deep_link: string;
}

/**
 * Webhook event do TikTok. A spec é menos padronizada que Meta —
 * cada tipo de evento tem schema próprio. Esta interface cobre os
 * comuns: comment.create + comment.reply + follow.
 *
 * Doc: https://developers.tiktok.com/doc/webhooks-overview
 */
export interface TikTokWebhookBody {
  /** Tipo do evento — varia conforme subscription. */
  event: string;
  /** Epoch (segundos) de quando o evento aconteceu. */
  create_time: number;
  /** open_id do user que disparou o evento (quem comentou, etc.) */
  user_open_id?: string;
  /** open_id do business owner (pra rotear pro canal correto) */
  to_user_id?: string;
  /** Conteúdo do comentário/dm */
  content?: string;
  /** ID do vídeo onde aconteceu (pra video.publish/comment.create) */
  video_id?: string;
  comment_id?: string;
  parent_comment_id?: string;
  /** Username do usuário que interagiu */
  username?: string;
  /** Avatar URL */
  user_avatar_url?: string;
  /** URL pública do vídeo */
  video_url?: string;
}

export interface TikTokCommentReplyResponse {
  data?: {
    comment?: {
      comment_id: string;
      text: string;
      create_time: number;
    };
  };
  error?: {
    code: string;
    message: string;
  };
}
