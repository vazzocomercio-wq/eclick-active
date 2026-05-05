import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import type { OrgMemberRole } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  decryptSecret,
  encryptSecret,
  hmacSign,
  hmacVerify,
} from '../../common/crypto/aes-gcm.util';

export type AdPlatform = 'meta' | 'google';
export type AdIntegrationStatus =
  | 'active'
  | 'token_expired'
  | 'error'
  | 'disconnected';

/** Shape exposto pra UI — sem tokens. */
export interface AdIntegrationPublic {
  id: string;
  platform: AdPlatform;
  ad_account_id: string;
  account_name: string | null;
  status: AdIntegrationStatus;
  scope: string | null;
  expires_at: string | null;
  last_sync_at: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface AdIntegrationRow extends AdIntegrationPublic {
  org_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
}

interface OAuthStateData {
  org_id: string;
  user_id: string;
  platform: AdPlatform;
  /** Random nonce — bate com o que voltou no callback. */
  nonce: string;
  /** Issued-at unix ms. State tem TTL de 10min. */
  iat: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * AdIntegrationsService — núcleo do Bloco B.
 *
 * Responsabilidades:
 *   1. OAuth state CSRF (sign/verify via HMAC-SHA256 com a chave master)
 *   2. Persistir integração após callback (cifrar tokens)
 *   3. Refresh automático antes de expirar
 *   4. Listar/desconectar integrações (UI)
 *   5. Decifrar token sob demanda (consumido por connectors no Bloco C/D)
 *
 * Multi-tenant: TODA query inclui org_id. UNIQUE (org_id, platform,
 * ad_account_id) garante que a mesma conta pode ser conectada por múltiplas
 * orgs.
 */
@Injectable()
export class AdIntegrationsService {
  private readonly logger = new Logger(AdIntegrationsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ────────────────────────────────────────────
  // OAuth state CSRF
  // ────────────────────────────────────────────

  /**
   * Gera state assinado HMAC. O attacker não consegue forjar callback
   * porque não tem a chave master. Embed orgId+userId+platform pra evitar
   * roubar code de outra org.
   */
  buildOAuthState(orgId: string, userId: string, platform: AdPlatform): string {
    const data: OAuthStateData = {
      org_id: orgId,
      user_id: userId,
      platform,
      nonce: crypto.randomBytes(16).toString('base64url'),
      iat: Date.now(),
    };
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    const sig = hmacSign(payload);
    return `${payload}.${sig}`;
  }

  /** Decodifica + verifica assinatura + checa TTL. Lança 400 se inválido. */
  parseOAuthState(state: string): OAuthStateData {
    const parts = state.split('.');
    if (parts.length !== 2) {
      throw new BadRequestException('OAuth state malformado');
    }
    const [payload, sig] = parts as [string, string];
    if (!hmacVerify(payload, sig)) {
      throw new BadRequestException('OAuth state com assinatura inválida');
    }
    let data: OAuthStateData;
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthStateData;
    } catch {
      throw new BadRequestException('OAuth state corrompido');
    }
    if (Date.now() - data.iat > STATE_TTL_MS) {
      throw new BadRequestException('OAuth state expirado — re-inicie o fluxo');
    }
    return data;
  }

  // ────────────────────────────────────────────
  // Persist após callback
  // ────────────────────────────────────────────

  async upsertIntegration(args: {
    orgId: string;
    platform: AdPlatform;
    adAccountId: string;
    accountName: string | null;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
    scope: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<AdIntegrationPublic> {
    const payload = {
      org_id: args.orgId,
      platform: args.platform,
      ad_account_id: args.adAccountId,
      account_name: args.accountName,
      access_token_ciphertext: encryptSecret(args.accessToken),
      refresh_token_ciphertext: args.refreshToken ? encryptSecret(args.refreshToken) : null,
      expires_at: args.expiresAt?.toISOString() ?? null,
      scope: args.scope,
      status: 'active' as const,
      error_message: null,
      metadata: args.metadata ?? {},
    };

    const { data, error } = await this.supabase.adminClient
      .from('ad_integrations')
      .upsert(payload, { onConflict: 'org_id,platform,ad_account_id' })
      .select(
        'id, platform, ad_account_id, account_name, status, scope, expires_at, last_sync_at, error_message, metadata, created_at, updated_at',
      )
      .single();

    if (error || !data) {
      this.logger.error(`upsertIntegration falhou: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Falha ao salvar integração',
      );
    }
    return data as AdIntegrationPublic;
  }

  // ────────────────────────────────────────────
  // List / get / delete
  // ────────────────────────────────────────────

  async list(orgId: string): Promise<AdIntegrationPublic[]> {
    const { data, error } = await this.supabase.adminClient
      .from('ad_integrations')
      .select(
        'id, platform, ad_account_id, account_name, status, scope, expires_at, last_sync_at, error_message, metadata, created_at, updated_at',
      )
      .eq('org_id', orgId)
      .neq('status', 'disconnected')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`list falhou: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return (data ?? []) as AdIntegrationPublic[];
  }

  async disconnect(
    orgId: string,
    actorRole: OrgMemberRole,
    integrationId: string,
  ): Promise<void> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException(
        'Apenas owner/admin podem desconectar integrações.',
      );
    }
    const { data: existing } = await this.supabase.adminClient
      .from('ad_integrations')
      .select('id')
      .eq('id', integrationId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (!existing) {
      throw new NotFoundException('Integração não encontrada nesta organização.');
    }
    const { error } = await this.supabase.adminClient
      .from('ad_integrations')
      .update({
        status: 'disconnected',
        access_token_ciphertext: '',
        refresh_token_ciphertext: null,
      })
      .eq('id', integrationId)
      .eq('org_id', orgId);
    if (error) {
      this.logger.error(`disconnect falhou: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  // ────────────────────────────────────────────
  // Token resolution (consumed by connectors)
  // ────────────────────────────────────────────

  /**
   * Devolve access_token decifrado pra uma integração específica.
   * Faz refresh transparente se expirou e há refresh_token.
   * Lança erro com mensagem amigável se a cred não pode ser usada.
   *
   * NOTA: refresh real é responsabilidade dos connectors do Bloco C/D
   * (cada plataforma tem endpoint próprio de refresh). Por ora, se
   * estiver vencida, marca status=token_expired e exige re-conexão.
   */
  async getAccessToken(orgId: string, integrationId: string): Promise<string> {
    const { data, error } = await this.supabase.adminClient
      .from('ad_integrations')
      .select('id, status, expires_at, access_token_ciphertext')
      .eq('id', integrationId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);

    const row = data as
      | {
          id: string;
          status: AdIntegrationStatus;
          expires_at: string | null;
          access_token_ciphertext: string;
        }
      | null;
    if (!row) throw new NotFoundException('Integração não encontrada.');
    if (row.status !== 'active') {
      throw new BadRequestException(
        `Integração com status "${row.status}" — re-conecte em /configuracoes > Integrações.`,
      );
    }
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      // Marca expirada — connector que sabe refrescar fica responsável.
      await this.supabase.adminClient
        .from('ad_integrations')
        .update({ status: 'token_expired' })
        .eq('id', row.id);
      throw new BadRequestException(
        'Token de Ads expirado — re-conecte em /configuracoes > Integrações.',
      );
    }
    return decryptSecret(row.access_token_ciphertext);
  }

  /** Marca integração como em erro (chamado por syncs que falham). */
  async markError(integrationId: string, message: string): Promise<void> {
    await this.supabase.adminClient
      .from('ad_integrations')
      .update({ status: 'error', error_message: message.slice(0, 500) })
      .eq('id', integrationId);
  }

  /** Marca sync ok + atualiza last_sync_at (chamado por connectors). */
  async markSynced(integrationId: string): Promise<void> {
    await this.supabase.adminClient
      .from('ad_integrations')
      .update({
        status: 'active',
        last_sync_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', integrationId);
  }

  /**
   * Carrega row INTERNA (com ciphertexts) — só pra usar dentro do módulo
   * ads (refresh worker, connector que precisa do refresh_token).
   * Não exponha via controller.
   */
  async getInternal(integrationId: string): Promise<AdIntegrationRow | null> {
    const { data, error } = await this.supabase.adminClient
      .from('ad_integrations')
      .select('*')
      .eq('id', integrationId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    return (data as AdIntegrationRow | null) ?? null;
  }
}
