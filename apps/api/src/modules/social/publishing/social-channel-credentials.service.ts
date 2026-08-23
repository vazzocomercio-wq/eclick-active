import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  encryptSecret,
  decryptSecret,
} from '../../../common/crypto/aes-gcm.util';
import type {
  SocialChannelCredential,
  PublishingChannel,
  ConnectedAccount,
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

  /** Todas as contas conectadas ativas da org (pro seletor de publicação). */
  async listAccounts(orgId: string): Promise<ConnectedAccount[]> {
    const { data, error } = await this.supabase.adminClient
      .from('social_channel_credentials')
      .select('id, channel, external_account_id, external_username, external_account_name, is_default')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('channel', { ascending: true })
      .order('external_username', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      credential_id: r.id as string,
      channel: r.channel as PublishingChannel,
      external_account_id: r.external_account_id as string,
      username: (r.external_username as string | null) ?? null,
      name: (r.external_account_name as string | null) ?? null,
      is_default: Boolean(r.is_default),
    }));
  }

  /**
   * Marca UMA conta como a padrão do canal dela. Limpa a anterior antes de
   * gravar a nova — o índice parcial do banco só permite uma padrão por
   * (org, canal) entre as ativas, então gravar sem limpar daria erro.
   */
  async setDefault(orgId: string, credId: string): Promise<SocialChannelCredential> {
    const { data: target } = await this.supabase.adminClient
      .from('social_channel_credentials')
      .select('*')
      .eq('id', credId)
      .eq('org_id', orgId)
      .maybeSingle();
    const cred = target as SocialChannelCredential | null;
    if (!cred) throw new Error('Conta não encontrada nesta organização');
    if (!cred.is_active) throw new Error('Conta desativada — reative antes de torná-la padrão');

    await this.supabase.adminClient
      .from('social_channel_credentials')
      .update({ is_default: false })
      .eq('org_id', orgId)
      .eq('channel', cred.channel)
      .neq('id', credId);

    const { data, error } = await this.supabase.adminClient
      .from('social_channel_credentials')
      .update({ is_default: true })
      .eq('id', credId)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    this.log.log(`[creds] conta padrão de ${cred.channel} agora é @${cred.external_username ?? credId}`);
    return data as SocialChannelCredential;
  }

  /** Usernames das contas ativas de um canal — pra montar mensagem de erro. */
  async listActiveUsernames(orgId: string, channel: PublishingChannel): Promise<string[]> {
    const { data } = await this.supabase.adminClient
      .from('social_channel_credentials')
      .select('external_username, external_account_id')
      .eq('org_id', orgId)
      .eq('channel', channel)
      .eq('is_active', true);
    return ((data ?? []) as Array<{ external_username: string | null; external_account_id: string }>)
      .map((r) => (r.external_username ? `@${r.external_username}` : r.external_account_id));
  }

  /**
   * Resolve a conta a usar quando a publicação NÃO escolheu alvo explícito.
   *
   * Ordem: conta da marca → conta marcada como padrão → única conta ativa.
   * Se há MAIS DE UMA conta ativa e nenhuma é padrão, devolve null de
   * propósito: antes isso caía em `ORDER BY created_at DESC LIMIT 1` e
   * publicava na última conta conectada. Na org da Vazzo, isso fazia a
   * padrão do Instagram ser a @s2trader (auditoria 23/08/2026) e a do
   * TikTok ser a @eclick_oficial. Publicar na conta errada de um cliente é
   * pior do que não publicar — então aqui a gente recusa e deixa o caller
   * explicar o que fazer.
   */
  async findActive(
    orgId: string,
    channel: PublishingChannel,
    brandId?: string | null,
  ): Promise<SocialChannelCredential | null> {
    if (brandId) {
      // Conta vinculada à marca ganha de tudo — é escolha explícita.
      const { data: branded } = await this.supabase.adminClient
        .from('social_channel_credentials')
        .select('*')
        .eq('org_id', orgId)
        .eq('channel', channel)
        .eq('is_active', true)
        .eq('brand_id', brandId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (branded) return branded as SocialChannelCredential;
    }

    const { data } = await this.supabase.adminClient
      .from('social_channel_credentials')
      .select('*')
      .eq('org_id', orgId)
      .eq('channel', channel)
      .eq('is_active', true)
      .is('brand_id', null);

    const rows = (data ?? []) as SocialChannelCredential[];
    if (rows.length === 0) return null;

    const marcada = rows.find((r) => r.is_default);
    if (marcada) return marcada;

    // Sem padrão marcada: só é seguro seguir quando não há o que escolher.
    if (rows.length === 1) return rows[0] ?? null;

    this.log.warn(
      `[creds] ${rows.length} contas ativas de ${channel} na org ${orgId.slice(0, 8)} e nenhuma marcada como padrão — recusando escolher`,
    );
    return null;
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
      let accessToken = decryptSecret(row.access_token_ciphertext);
      const refreshToken = row.refresh_token_ciphertext
        ? decryptSecret(row.refresh_token_ciphertext)
        : null;

      // Auto-refresh do TikTok: o access token do Content Posting API dura ~24h.
      // Se está expirado (ou perto), renova com o refresh_token ANTES de publicar
      // — senão o publish quebra por auth. Refresh tokens duram ~365 dias.
      if (channel === 'tiktok_business' && refreshToken) {
        const expMs = cred.expires_at ? new Date(cred.expires_at).getTime() : 0;
        if (!expMs || expMs < Date.now() + 5 * 60 * 1000) {
          const fresh = await this.refreshTikTokToken(cred, refreshToken);
          if (fresh) accessToken = fresh;
        }
      }

      // Auto-refresh do Instagram: long-lived token da Meta dura ~60 dias e é
      // renovável trocando o token atual (fb_exchange_token) — sem isso o
      // cliente teria que reconectar a conta a cada 2 meses.
      if (channel === 'instagram_business') {
        const fresh = await this.maybeRefreshInstagramToken(cred, accessToken);
        if (fresh) accessToken = fresh;
      }

      return { cred, access_token: accessToken, refresh_token: refreshToken };
    } catch (err) {
      this.log.warn(`getDecryptedToken falhou: ${String(err)}`);
      return null;
    }
  }

  /**
   * Igual ao getDecryptedToken, mas pra uma credencial ESPECÍFICA (por id) —
   * usado quando o caller escolhe a conta de destino (multi-conta). Mantém o
   * auto-refresh do TikTok.
   */
  async getDecryptedTokenByCredId(
    orgId: string,
    credId: string,
  ): Promise<{
    cred: SocialChannelCredential;
    access_token: string;
    refresh_token: string | null;
  } | null> {
    const { data } = await this.supabase.adminClient
      .from('social_channel_credentials')
      .select('*')
      .eq('id', credId)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .maybeSingle();
    const cred = data as SocialChannelCredential | null;
    if (!cred) return null;
    try {
      const { data: tok } = await this.supabase.adminClient
        .from('social_channel_credentials')
        .select('access_token_ciphertext, refresh_token_ciphertext')
        .eq('id', cred.id)
        .single();
      const row = tok as {
        access_token_ciphertext: string;
        refresh_token_ciphertext: string | null;
      };
      let accessToken = decryptSecret(row.access_token_ciphertext);
      const refreshToken = row.refresh_token_ciphertext
        ? decryptSecret(row.refresh_token_ciphertext)
        : null;
      if (cred.channel === 'tiktok_business' && refreshToken) {
        const expMs = cred.expires_at ? new Date(cred.expires_at).getTime() : 0;
        if (!expMs || expMs < Date.now() + 5 * 60 * 1000) {
          const fresh = await this.refreshTikTokToken(cred, refreshToken);
          if (fresh) accessToken = fresh;
        }
      }
      if (cred.channel === 'instagram_business') {
        const fresh = await this.maybeRefreshInstagramToken(cred, accessToken);
        if (fresh) accessToken = fresh;
      }
      return { cred, access_token: accessToken, refresh_token: refreshToken };
    } catch (err) {
      this.log.warn(`getDecryptedTokenByCredId falhou: ${String(err)}`);
      return null;
    }
  }

  /** Renova o access token do TikTok (grant_type=refresh_token). Atualiza o
   *  ciphertext + expires_at (refresh token rotaciona — grava o novo). Devolve o
   *  novo access_token, ou null se falhar (e marca last_error). */
  private async refreshTikTokToken(
    cred: SocialChannelCredential,
    refreshToken: string,
  ): Promise<string | null> {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) {
      this.log.warn('[tiktok.refresh] TIKTOK_CLIENT_KEY/SECRET ausentes');
      return null;
    }
    try {
      const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cache-Control': 'no-cache',
        },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
        signal: AbortSignal.timeout(20_000),
      });
      const tok = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
        refresh_token?: string;
        error?: string;
        error_description?: string;
      };
      if (!res.ok || tok.error || !tok.access_token) {
        await this.markError(
          cred.id,
          `tiktok refresh falhou: ${tok.error_description ?? tok.error ?? res.status}`,
        );
        return null;
      }
      const update: Record<string, unknown> = {
        access_token_ciphertext: encryptSecret(tok.access_token),
        expires_at: tok.expires_in
          ? new Date(Date.now() + tok.expires_in * 1000).toISOString()
          : null,
        last_validated_at: new Date().toISOString(),
        last_error: null,
      };
      if (tok.refresh_token) {
        update.refresh_token_ciphertext = encryptSecret(tok.refresh_token);
      }
      await this.supabase.adminClient
        .from('social_channel_credentials')
        .update(update)
        .eq('id', cred.id);
      this.log.log(`[tiktok.refresh] token renovado (cred ${cred.id})`);
      return tok.access_token;
    } catch (err) {
      this.log.warn(`[tiktok.refresh] erro: ${String(err)}`);
      return null;
    }
  }

  /** Renova o long-lived token da Meta (grant_type=fb_exchange_token) quando
   *  expires_at está a <7 dias (ou é desconhecido — nesse caso a resposta
   *  traz expires_in e o expires_at se auto-corrige). Devolve o novo
   *  access_token, ou null se não precisou/não conseguiu (mantém o atual). */
  private async maybeRefreshInstagramToken(
    cred: SocialChannelCredential,
    accessToken: string,
  ): Promise<string | null> {
    const expMs = cred.expires_at ? new Date(cred.expires_at).getTime() : 0;
    if (expMs && expMs - Date.now() > 7 * 24 * 60 * 60 * 1000) return null;

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      this.log.warn('[ig.refresh] META_APP_ID/SECRET ausentes — sem refresh');
      return null;
    }
    try {
      const url = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
      url.searchParams.set('grant_type', 'fb_exchange_token');
      url.searchParams.set('client_id', appId);
      url.searchParams.set('client_secret', appSecret);
      url.searchParams.set('fb_exchange_token', accessToken);

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(20_000),
      });
      const tok = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
        error?: { message?: string };
      };
      if (!res.ok || tok.error || !tok.access_token) {
        await this.markError(
          cred.id,
          `ig refresh falhou: ${tok.error?.message ?? res.status}`,
        );
        return null;
      }
      await this.supabase.adminClient
        .from('social_channel_credentials')
        .update({
          access_token_ciphertext: encryptSecret(tok.access_token),
          // Meta às vezes devolve o mesmo token sem expires_in (quando foi
          // trocado há <24h) — assume os 60 dias padrão nesse caso
          expires_at: new Date(
            Date.now() + (tok.expires_in ?? 60 * 24 * 60 * 60) * 1000,
          ).toISOString(),
          last_validated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', cred.id)
        .eq('org_id', cred.org_id);
      this.log.log(`[ig.refresh] token renovado (cred ${cred.id})`);
      return tok.access_token;
    } catch (err) {
      this.log.warn(`[ig.refresh] erro: ${String(err)}`);
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
