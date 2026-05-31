import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { encryptApiKey, decryptApiKey } from '../../../common/llm/crypto.util';

/**
 * Canais do YouTube pro Studio de Cortes — OAuth PRÓPRIO (separado do Drive),
 * multi-canal. O Google mostra o seletor de canal no consentimento, então o
 * usuário escolhe o canal certo (ex: e-Click Oficial, um Brand Channel). Cada
 * conexão vira uma "conta" selecionável por corte.
 *
 * Escopo: youtube.upload + youtube.readonly (sem Drive). Token de cada canal
 * sobe SÓ naquele canal.
 */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE =
  'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
const STATE_TTL_MS = 15 * 60 * 1000;

interface ChannelRow {
  id: string;
  org_id: string;
  youtube_channel_id: string;
  title: string | null;
  thumbnail_url: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  status: string;
}

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

@Injectable()
export class CortesYouTubeService {
  private readonly log = new Logger(CortesYouTubeService.name);

  constructor(private readonly supabase: SupabaseService) {}

  private requireEnv(name: string): string {
    const v = process.env[name]?.trim();
    if (!v) throw new BadRequestException(`${name} não configurada (OAuth Google).`);
    return v;
  }

  private redirectUri(): string {
    const base = (process.env.API_PUBLIC_URL ?? process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
    if (!base) throw new BadRequestException('API_PUBLIC_URL não configurada.');
    return `${base}/studio-cortes/youtube/callback`;
  }

  // ── State assinado ────────────────────────────────────────

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

  // ── Connect / callback ────────────────────────────────────

  getAuthUrl(orgId: string): string {
    const params = new URLSearchParams({
      client_id: this.requireEnv('GOOGLE_CLIENT_ID'),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent select_account', // força escolher conta/canal
      include_granted_scopes: 'true',
      state: this.signState(orgId),
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, state: string): Promise<{ orgId: string }> {
    const orgId = this.verifyState(state);
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.requireEnv('GOOGLE_CLIENT_ID'),
        client_secret: this.requireEnv('GOOGLE_CLIENT_SECRET'),
        redirect_uri: this.redirectUri(),
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(`YouTube token exchange falhou: ${await res.text()}`);
    }
    const tokens = (await res.json()) as GoogleTokens;
    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'Google não retornou refresh_token. Remova o acesso em myaccount.google.com/permissions e conecte de novo.',
      );
    }

    // Descobre o canal selecionado no consentimento.
    const chRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    const chJson = (await chRes.json()) as {
      items?: Array<{ id: string; snippet?: { title?: string; thumbnails?: { default?: { url?: string } } } }>;
    };
    const ch = chJson.items?.[0];
    if (!ch?.id) {
      throw new BadRequestException(
        'Não consegui identificar o canal do YouTube. A conta tem um canal? Tente de novo escolhendo o canal certo.',
      );
    }

    await this.supabase.adminClient.from('cortes_youtube_channels').upsert(
      {
        org_id: orgId,
        youtube_channel_id: ch.id,
        title: ch.snippet?.title ?? null,
        thumbnail_url: ch.snippet?.thumbnails?.default?.url ?? null,
        access_token: encryptApiKey(tokens.access_token),
        refresh_token: encryptApiKey(tokens.refresh_token),
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scopes: (tokens.scope ?? SCOPE).split(/\s+/).filter(Boolean),
        status: 'active',
        last_error: null,
      },
      { onConflict: 'org_id,youtube_channel_id' },
    );
    this.log.log(`[youtube] org ${orgId} conectou canal ${ch.snippet?.title} (${ch.id})`);
    return { orgId };
  }

  async listChannels(orgId: string): Promise<
    Array<{ id: string; youtube_channel_id: string; title: string | null; thumbnail_url: string | null }>
  > {
    const { data } = await this.supabase.adminClient
      .from('cortes_youtube_channels')
      .select('id, youtube_channel_id, title, thumbnail_url')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .order('created_at', { ascending: true });
    return (data ?? []) as Array<{
      id: string;
      youtube_channel_id: string;
      title: string | null;
      thumbnail_url: string | null;
    }>;
  }

  async disconnect(orgId: string, credId: string): Promise<void> {
    await this.supabase.adminClient
      .from('cortes_youtube_channels')
      .delete()
      .eq('id', credId)
      .eq('org_id', orgId);
  }

  /** Token válido (refresh) de um canal específico. */
  async getValidAccessToken(orgId: string, credId: string): Promise<string> {
    const { data } = await this.supabase.adminClient
      .from('cortes_youtube_channels')
      .select('*')
      .eq('id', credId)
      .eq('org_id', orgId)
      .maybeSingle();
    const ch = data as ChannelRow | null;
    if (!ch || ch.status !== 'active' || !ch.refresh_token) {
      throw new BadRequestException('Canal do YouTube não conectado.');
    }
    const expiresAt = ch.token_expires_at ? new Date(ch.token_expires_at).getTime() : 0;
    if (expiresAt - Date.now() > 2 * 60_000 && ch.access_token) {
      const cached = decryptApiKey(ch.access_token);
      if (cached) return cached;
    }
    const refresh = decryptApiKey(ch.refresh_token);
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.requireEnv('GOOGLE_CLIENT_ID'),
        client_secret: this.requireEnv('GOOGLE_CLIENT_SECRET'),
        refresh_token: refresh,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) {
      const msg = await res.text();
      await this.supabase.adminClient
        .from('cortes_youtube_channels')
        .update({ status: 'error', last_error: msg.slice(0, 400) })
        .eq('id', ch.id);
      throw new InternalServerErrorException(`Refresh do canal YouTube falhou: ${msg.slice(0, 160)}`);
    }
    const t = (await res.json()) as GoogleTokens;
    await this.supabase.adminClient
      .from('cortes_youtube_channels')
      .update({
        access_token: encryptApiKey(t.access_token),
        token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
        status: 'active',
        last_error: null,
      })
      .eq('id', ch.id);
    return t.access_token;
  }
}
