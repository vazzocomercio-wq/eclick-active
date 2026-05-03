/**
 * Tipos do canal Instagram Direct via Meta Graph API.
 * Doc oficial: https://developers.facebook.com/docs/messenger-platform/instagram
 */

export interface InstagramCredentials {
  /** ID da Page do Facebook vinculada à conta IG business */
  page_id: string;
  /** ID-scoped do user IG business (ig_user_id) — usado nos endpoints /messages */
  ig_user_id: string;
  /** Page access token long-lived (60 dias) — criptografar em produção */
  page_access_token: string;
  /** App ID usado pra refresh do token */
  app_id: string;
  /** Username do IG (apenas display) */
  username?: string;
  /** ISO de quando o page_access_token foi emitido (pra calcular expiração) */
  token_issued_at?: string;
}

/**
 * Webhook event do Messenger Platform (compartilhado entre IG e Messenger).
 * Recebido em /webhooks/instagram via POST.
 *
 * Doc: https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook
 */
export interface InstagramWebhookBody {
  object: 'instagram';
  entry: InstagramWebhookEntry[];
}

export interface InstagramWebhookEntry {
  id: string; // ig_user_id
  time: number; // epoch ms
  messaging?: InstagramMessagingEvent[];
  changes?: InstagramChangeEvent[];
}

export interface InstagramMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: InstagramIncomingMessage;
  delivery?: { mids?: string[]; watermark: number };
  read?: { watermark: number };
  /** Reação a uma mensagem (👍, ❤️, etc.) */
  reaction?: {
    mid: string;
    action: 'react' | 'unreact';
    emoji?: string;
  };
}

export interface InstagramIncomingMessage {
  /** Message ID (mid_xxx) */
  mid: string;
  text?: string;
  attachments?: InstagramAttachment[];
  /** Quando true, mensagem que NÓS enviamos (echo) — ignorar */
  is_echo?: boolean;
  /** Reply pra outra mensagem (threading) */
  reply_to?: { mid: string };
  /** Story mention/reply context */
  is_unsupported?: boolean;
}

export interface InstagramAttachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'story_mention' | 'share' | 'fallback';
  payload: {
    url?: string;
    sticker_id?: number;
  };
}

export interface InstagramChangeEvent {
  field: string;
  value: unknown;
}

/** Resposta do POST /me/messages */
export interface InstagramSendResponse {
  recipient_id: string;
  message_id: string;
  error?: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
  };
}

/** Resposta do GET /me/accounts */
export interface FacebookPageInfo {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  instagram_business_account?: { id: string };
}

/** Resposta do GET /{page_id}?fields=instagram_business_account */
export interface InstagramBusinessAccount {
  id: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
}
