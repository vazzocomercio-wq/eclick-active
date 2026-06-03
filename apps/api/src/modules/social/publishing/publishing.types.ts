/**
 * Tipos do subsistema de publicação automática.
 */

export type PublishingChannel =
  | 'instagram_business'
  | 'tiktok_business'
  | 'facebook_page';

export interface SocialChannelCredential {
  id: string;
  org_id: string;
  brand_id: string | null;
  channel: PublishingChannel;
  external_account_id: string;
  external_username: string | null;
  external_account_name: string | null;
  expires_at: string | null;
  scopes: string[];
  metadata: Record<string, unknown>;
  is_active: boolean;
  last_validated_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SocialPublishAttempt {
  id: string;
  org_id: string;
  content_id: string;
  channel: string;
  credential_id: string | null;
  status: 'pending' | 'success' | 'failed' | 'partial';
  external_post_id: string | null;
  external_post_url: string | null;
  provider_response: Record<string, unknown>;
  error_message: string | null;
  error_code: string | null;
  attempted_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface PublishInput {
  /** Caption já com hashtags + CTA inseridos. */
  caption: string;
  /** Lista de URLs públicas (signed URLs do Storage). */
  image_urls: string[];
  /** Pra carrossel: ordem dos slides. Pra post estático: 1 url só. */
  is_carousel: boolean;
  /** Vídeo URL (futuro). */
  video_url?: string;
  /** Alt text pra acessibilidade. */
  alt_text?: string;
}

export interface PublishResult {
  success: boolean;
  external_post_id?: string;
  external_post_url?: string;
  error_message?: string;
  error_code?: string;
  provider_response: Record<string, unknown>;
}

export interface PublishingProvider {
  readonly channel: PublishingChannel;
  /** True se há credencial ativa pra esta org/canal. */
  isAvailable(orgId: string, brandId?: string | null): Promise<boolean>;
  publish(
    orgId: string,
    input: PublishInput,
    brandId?: string | null,
    /** Conta específica (credential id). Sem isso, resolve a conta padrão. */
    credId?: string,
  ): Promise<PublishResult>;
}

/** Conta conectada (pra o seletor de publicação multi-rede/multi-conta). */
export interface ConnectedAccount {
  credential_id: string;
  channel: PublishingChannel;
  external_account_id: string;
  username: string | null;
  name: string | null;
}

/** Alvo explícito de publicação: uma conta de um canal. */
export interface PublishTarget {
  channel: PublishingChannel;
  credential_id: string;
}
