import {
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { SocialChannelCredentialsService } from './social-channel-credentials.service';
import { encryptSecret, decryptSecret } from '../../../common/crypto/aes-gcm.util';

/**
 * OAuth de conexão da conta TikTok para PUBLICAR conteúdo (Content Posting API).
 *
 * ⚠️ NÃO confundir com:
 *   - `/channels/tiktok/*` (TikTokOAuthController) → conecta TikTok pro Inbox
 *     (responder comentários/follows), scopes comment.* — NÃO posta.
 *   - TikTok Shop → comércio, app/portal separado.
 *
 * Este fluxo pede scopes `video.publish` + `video.upload` e salva o token em
 * `social_channel_credentials` (channel='tiktok_business'), que é de onde o
 * TikTokBusinessProvider lê na hora de postar o reel via PULL_FROM_URL.
 *
 * Pré-requisitos externos (lado do cliente):
 *   1. App no TikTok for Developers com Login Kit + Content Posting API.
 *   2. Scopes video.publish + video.upload habilitados.
 *   3. Redirect URI deste callback registrado no app (= TIKTOK_PUBLISH_REDIRECT_URI).
 *   4. Domínio da URL do vídeo verificado (URL ownership) p/ PULL_FROM_URL.
 *   5. Enquanto o app não passa pela auditoria do TikTok, só posta privado
 *      (privacy_level SELF_ONLY — gravado no metadata da credencial).
 *
 * State criptografado via LLM_CRED_ENCRYPTION_KEY (mesma chave master da app),
 * carrega org_id + agent_id + ts (rejeita > 10min → anti-replay).
 *
 * Doc: https://developers.tiktok.com/doc/login-kit-web /
 *      https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
 */

const TIKTOK_AUTHORIZE = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_API = 'https://open.tiktokapis.com/v2';

// Scopes para POSTAR conteúdo (diferente do Inbox, que usa comment.*).
const PUBLISH_SCOPES = ['user.info.basic', 'video.publish', 'video.upload'].join(
  ',',
);

function encodeState(payload: { org_id: string; agent_id: string }): string {
  const enc = encryptSecret(JSON.stringify({ ...payload, ts: Date.now() }));
  // base64url-safe pra querystring
  return enc.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function decodeState(
  state: string,
): { org_id: string; agent_id: string } | null {
  try {
    let b64 = state.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const json = decryptSecret(b64);
    const parsed = JSON.parse(json) as {
      org_id: string;
      agent_id: string;
      ts: number;
    };
    if (Date.now() - parsed.ts > 10 * 60 * 1000) return null;
    return { org_id: parsed.org_id, agent_id: parsed.agent_id };
  } catch {
    return null;
  }
}

interface TikTokTokenJson {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  open_id?: string;
  error?: string;
  error_description?: string;
}

@Controller('social/connect/tiktok')
export class TikTokConnectController {
  private readonly log = new Logger(TikTokConnectController.name);

  constructor(private readonly creds: SocialChannelCredentialsService) {}

  /** Inicia o OAuth — front redireciona o usuário pra esta URL do TikTok. */
  @UseGuards(AuthGuard)
  @Get('auth')
  authUrl(@CurrentUser() user: AuthUser): { url: string } {
    const clientKey = this.requireEnv('TIKTOK_CLIENT_KEY');
    const redirectUri = this.requireEnv('TIKTOK_PUBLISH_REDIRECT_URI');
    const params = new URLSearchParams({
      client_key: clientKey,
      scope: PUBLISH_SCOPES,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: encodeState({ org_id: user.org_id, agent_id: user.id }),
    });
    return { url: `${TIKTOK_AUTHORIZE}?${params.toString()}` };
  }

  /** Callback do TikTok — troca code por token e salva a credencial. */
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDesc: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const webBase = process.env.WEB_BASE_URL ?? 'https://active.eclick.app.br';
    const back = (q: string): void =>
      res.redirect(`${webBase}/configuracoes/social?${q}`);

    if (error) {
      back(`tiktok=error&reason=${encodeURIComponent(errorDesc ?? error)}`);
      return;
    }
    if (!code || !state) {
      back('tiktok=error&reason=missing_code_or_state');
      return;
    }
    const decoded = decodeState(state);
    if (!decoded) {
      back('tiktok=error&reason=invalid_state');
      return;
    }

    try {
      const clientKey = this.requireEnv('TIKTOK_CLIENT_KEY');
      const clientSecret = this.requireEnv('TIKTOK_CLIENT_SECRET');
      const redirectUri = this.requireEnv('TIKTOK_PUBLISH_REDIRECT_URI');

      // 1) code → token
      const tokRes = await fetch(TIKTOK_TOKEN, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cache-Control': 'no-cache',
        },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }).toString(),
        signal: AbortSignal.timeout(20_000),
      });
      const tok = (await tokRes.json()) as TikTokTokenJson;
      if (!tokRes.ok || tok.error || !tok.access_token) {
        throw new Error(
          tok.error_description ?? tok.error ?? 'Falha na troca de token',
        );
      }

      // 2) user info (best-effort — username pra exibir e montar URL do post)
      let username: string | undefined;
      let displayName: string | undefined;
      try {
        const uRes = await fetch(
          `${TIKTOK_API}/user/info/?fields=open_id,union_id,avatar_url,display_name,username`,
          {
            headers: { Authorization: `Bearer ${tok.access_token}` },
            signal: AbortSignal.timeout(15_000),
          },
        );
        const uJson = (await uRes.json()) as {
          data?: {
            user?: { open_id?: string; username?: string; display_name?: string };
          };
        };
        username = uJson.data?.user?.username;
        displayName = uJson.data?.user?.display_name;
      } catch {
        /* best-effort */
      }

      const openId = tok.open_id ?? username ?? `tiktok-${Date.now()}`;
      const expiresAt = tok.expires_in
        ? new Date(Date.now() + tok.expires_in * 1000).toISOString()
        : undefined;

      await this.creds.saveCredential(decoded.org_id, {
        channel: 'tiktok_business',
        external_account_id: openId,
        external_username: username,
        external_account_name: displayName,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_at: expiresAt,
        scopes: (tok.scope ?? PUBLISH_SCOPES).split(','),
        // App auditado/aprovado pelo TikTok (2026-07-06) → Direct Post pode
        // sair público. Trocar pra SELF_ONLY na credencial se algum cliente
        // preferir revisar no app antes de publicar.
        metadata: { privacy_level: 'PUBLIC_TO_EVERYONE' },
      });

      back(`tiktok=success&user=${encodeURIComponent(username ?? '')}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erro';
      this.log.error(`TikTok connect callback falhou: ${msg}`);
      back(`tiktok=error&reason=${encodeURIComponent(msg)}`);
    }
  }

  private requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new InternalServerErrorException(`Env var ${name} ausente`);
    return v;
  }
}
