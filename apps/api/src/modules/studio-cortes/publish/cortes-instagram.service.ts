import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { SocialChannelCredentialsService } from '../../social/publishing/social-channel-credentials.service';

/**
 * "Conectar Instagram" de 1 clique pro Studio de Cortes (Facebook Login).
 * O usuário loga no Facebook e o callback descobre SOZINHO todas as contas
 * Instagram Business que ele administra (via /me/accounts), salvando cada uma
 * como credencial selecionável — sem Graph Explorer, sem token na mão.
 *
 * Escopos de PUBLICAÇÃO (diferente do OAuth de mensagens do Inbox):
 * instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement.
 *
 * ⚠️ Requer o redirect /studio-cortes/instagram/callback cadastrado no app Meta.
 */

const FB_VERSION = 'v21.0';
const FB_AUTH = `https://www.facebook.com/${FB_VERSION}/dialog/oauth`;
const GRAPH = `https://graph.facebook.com/${FB_VERSION}`;
const SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
].join(',');
const STATE_TTL_MS = 15 * 60 * 1000;

interface IgPage {
  id: string;
  name?: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}

@Injectable()
export class CortesInstagramService {
  private readonly log = new Logger(CortesInstagramService.name);

  constructor(private readonly creds: SocialChannelCredentialsService) {}

  private requireEnv(name: string): string {
    const v = process.env[name]?.trim();
    if (!v) throw new BadRequestException(`${name} não configurada (app Meta).`);
    return v;
  }

  private redirectUri(): string {
    const base = (process.env.API_PUBLIC_URL ?? process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
    if (!base) throw new BadRequestException('API_PUBLIC_URL não configurada.');
    return `${base}/studio-cortes/instagram/callback`;
  }

  private signState(orgId: string): string {
    const payload = Buffer.from(JSON.stringify({ org_id: orgId, ts: Date.now() })).toString('base64url');
    const mac = createHmac('sha256', this.requireEnv('LLM_CRED_ENCRYPTION_KEY'))
      .update(payload)
      .digest('base64url');
    return `${payload}.${mac}`;
  }

  private verifyState(state: string): string {
    const [payload, mac] = (state ?? '').split('.');
    if (!payload || !mac) throw new BadRequestException('State inválido.');
    const expected = createHmac('sha256', this.requireEnv('LLM_CRED_ENCRYPTION_KEY'))
      .update(payload)
      .digest('base64url');
    if (mac !== expected) throw new BadRequestException('State adulterado.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      org_id: string;
      ts: number;
    };
    if (Date.now() - decoded.ts > STATE_TTL_MS) throw new BadRequestException('State expirado.');
    return decoded.org_id;
  }

  getAuthUrl(orgId: string): string {
    const params = new URLSearchParams({
      client_id: this.requireEnv('META_APP_ID'),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: SCOPES,
      state: this.signState(orgId),
    });
    return `${FB_AUTH}?${params.toString()}`;
  }

  /** Troca o code, pega long-lived token, lista contas IG e salva cada uma. */
  async handleCallback(code: string, state: string): Promise<{ orgId: string; connected: number }> {
    const orgId = this.verifyState(state);
    const clientId = this.requireEnv('META_APP_ID');
    const clientSecret = this.requireEnv('META_APP_SECRET');

    // 1. code → short-lived user token
    const shortRes = await fetch(
      `${GRAPH}/oauth/access_token?` +
        new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: this.redirectUri(),
          code,
        }).toString(),
    );
    const shortJson = (await shortRes.json()) as { access_token?: string; error?: { message?: string } };
    if (!shortJson.access_token) {
      throw new BadRequestException(`Troca de code falhou: ${shortJson.error?.message ?? 'erro'}`);
    }

    // 2. short → long-lived (60d)
    const longRes = await fetch(
      `${GRAPH}/oauth/access_token?` +
        new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: clientId,
          client_secret: clientSecret,
          fb_exchange_token: shortJson.access_token,
        }).toString(),
    );
    const longJson = (await longRes.json()) as { access_token?: string; expires_in?: number };
    const userToken = longJson.access_token ?? shortJson.access_token;
    const expiresAt = longJson.expires_in
      ? new Date(Date.now() + longJson.expires_in * 1000).toISOString()
      : undefined;

    // 3. pages + contas IG Business
    const pagesRes = await fetch(
      `${GRAPH}/me/accounts?` +
        new URLSearchParams({
          fields: 'id,name,access_token,instagram_business_account{id,username}',
          access_token: userToken,
          limit: '100',
        }).toString(),
    );
    const pagesJson = (await pagesRes.json()) as { data?: IgPage[]; error?: { message?: string } };
    const igPages = (pagesJson.data ?? []).filter((p) => p.instagram_business_account?.id);
    if (igPages.length === 0) {
      throw new BadRequestException(
        'Nenhuma conta Instagram Business vinculada às suas páginas. Vincule no Meta Business Suite e tente de novo.',
      );
    }

    // 4. salva cada conta IG como credencial selecionável
    let connected = 0;
    for (const p of igPages) {
      const ig = p.instagram_business_account!;
      await this.creds.saveCredential(orgId, {
        channel: 'instagram_business',
        external_account_id: ig.id,
        external_username: ig.username,
        external_account_name: p.name,
        access_token: p.access_token, // page token (long-lived)
        expires_at: expiresAt,
        scopes: SCOPES.split(','),
        metadata: { page_id: p.id, connected_via: 'cortes_oauth' },
      });
      connected += 1;
    }
    this.log.log(`[instagram] org ${orgId} conectou ${connected} conta(s) IG`);
    return { orgId, connected };
  }
}
