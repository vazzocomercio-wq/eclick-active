import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  encryptSecret,
  decryptSecret,
} from '../../../common/crypto/aes-gcm.util';
import type {
  SocialChannelCredential,
  PublishingChannel,
} from './publishing.types';

interface SaveCredentialInput {
  channel: PublishingChannel;
  brand_id?: string | null;
  external_account_id: string;
  external_username?: string;
  external_account_name?: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Service de credenciais de canais sociais. Tokens são encryptados via
 * AES-256-GCM (mesma chave LLM_CRED_ENCRYPTION_KEY) antes de persistir.
 *
 * `getDecryptedToken()` é o ponto que decifra — provider chama na hora
 * de publicar. Nunca expor token cru pelo controller.
 */
@Injectable()
export class SocialChannelCredentialsService {
  private readonly log = new Logger(SocialChannelCredentialsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async saveCredential(
    orgId: string,
    input: SaveCredentialInput,
  ): Promise<SocialChannelCredential> {
    const accessCipher = encryptSecret(input.access_token);
    const refreshCipher = input.refresh_token
      ? encryptSecret(input.refresh_token)
      : null;

    const { data, error } = await this.supabase.adminClient
      .from('social_channel_credentials')
      .upsert(
        {
          org_id: orgId,
          brand_id: input.brand_id ?? null,
          channel: input.channel,
          external_account_id: input.external_account_id,
          external_username: input.external_username ?? null,
          external_account_name: input.external_account_name ?? null,
          access_token_ciphertext: accessCipher,
          refresh_token_ciphertext: refreshCipher,
          expires_at: input.expires_at ?? null,
          scopes: input.scopes ?? [],
          metadata: input.metadata ?? {},
          is_active: true,
          last_validated_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: 'org_id,channel,external_account_id' },
      )
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialChannelCredential;
  }

  async list(orgId: string): Promise<SocialChannelCredential[]> {
    const { data, error } = await this.supabase.adminClient
      .from('social_channel_credentials')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as SocialChannelCredential[];
  }

  async findActive(
    orgId: string,
    channel: PublishingChannel,
    brandId?: string | null,
  ): Promise<SocialChannelCredential | null> {
    let q = this.supabase.adminClient
      .from('social_channel_credentials')
      .select('*')
      .eq('org_id', orgId)
      .eq('channel', channel)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1);
    if (brandId) {
      // Prioriza cred vinculada à marca; se não tem, tenta a default (sem brand)
      const { data: branded } = await q.eq('brand_id', brandId).maybeSingle();
      if (branded) return branded as SocialChannelCredential;
    }
    const { data } = await this.supabase.adminClient
      .from('social_channel_credentials')
      .select('*')
      .eq('org_id', orgId)
      .eq('channel', channel)
      .eq('is_active', true)
      .is('brand_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as SocialChannelCredential | null) ?? null;
  }

  async getDecryptedToken(
    orgId: string,
    channel: PublishingChannel,
    brandId?: string | null,
  ): Promise<{
    cred: SocialChannelCredential;
    access_token: string;
    refresh_token: string | null;
  } | null> {
    const cred = await this.findActive(orgId, channel, brandId);
    if (!cred) return null;
    try {
      const { data } = await this.supabase.adminClient
        .from('social_channel_credentials')
        .select('access_token_ciphertext, refresh_token_ciphertext')
        .eq('id', cred.id)
        .single();
      const row = data as {
        access_token_ciphertext: string;
        refresh_token_ciphertext: string | null;
      };
      return {
        cred,
        access_token: decryptSecret(row.access_token_ciphertext),
        refresh_token: row.refresh_token_ciphertext
          ? decryptSecret(row.refresh_token_ciphertext)
          : null,
      };
    } catch (err) {
      this.log.warn(`getDecryptedToken falhou: ${String(err)}`);
      return null;
    }
  }

  async deactivate(orgId: string, id: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('social_channel_credentials')
      .update({ is_active: false })
      .eq('id', id)
      .eq('org_id', orgId);
    if (error) throw error;
  }

  async delete(orgId: string, id: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('social_channel_credentials')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);
    if (error) throw error;
  }

  async markError(id: string, error: string): Promise<void> {
    await this.supabase.adminClient
      .from('social_channel_credentials')
      .update({ last_error: error.slice(0, 500) })
      .eq('id', id);
  }

  async findById(orgId: string, id: string): Promise<SocialChannelCredential> {
    const { data } = await this.supabase.adminClient
      .from('social_channel_credentials')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Credencial não encontrada');
    return data as SocialChannelCredential;
  }
}
