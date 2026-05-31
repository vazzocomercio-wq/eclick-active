import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { encryptApiKey, decryptApiKey } from '../../common/llm/crypto.util';

/**
 * Cliente do Google Drive do Studio de Cortes — autentica via **OAuth do
 * usuário** (não Service Account), porque conta Gmail pessoal não tem Shared
 * Drive e SA não tem cota de storage. Escopo `drive.file` (não-sensível: o app
 * só enxerga/gerencia o que ele mesmo cria). Arquivos ficam no Drive do
 * usuário e contam a cota dele.
 *
 * Conexão (refresh_token cifrado + pasta raiz) vive em
 * active.cortes_drive_connections, 1 por org.
 *
 * Envs: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, API_PUBLIC_URL,
 *       LLM_CRED_ENCRYPTION_KEY (cripto dos tokens).
 */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
// drive.file (storage dos cortes) + youtube.upload (publicar Shorts no Sprint 2).
// Mesma conta Google, consentimento ampliado. youtube.upload é escopo sensível →
// em produção sem verificação o Google mostra aviso "app não verificado" só no
// YouTube (o usuário avança normal); não afeta o drive.file.
const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const SCOPE = `https://www.googleapis.com/auth/drive.file ${YOUTUBE_UPLOAD_SCOPE}`;
const ROOT_FOLDER_NAME = 'e-Click Cortes';
const STATE_TTL_MS = 15 * 60 * 1000;

interface ConnectionRow {
  id: string;
  org_id: string;
  google_email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  root_folder_id: string | null;
  scopes: string[] | null;
  status: string;
}

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  /** Escopos concedidos (space-separated). */
  scope?: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
}

export interface DriveQuota {
  limit: number | null;
  usage: number;
  percent: number;
}

@Injectable()
export class CortesDriveClient {
  private readonly log = new Logger(CortesDriveClient.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ── Env helpers ───────────────────────────────────────────

  private requireEnv(name: string): string {
    const v = process.env[name]?.trim();
    if (!v) {
      throw new BadRequestException(
        `${name} não configurada no Railway active-api — necessária pro OAuth do Google Drive.`,
      );
    }
    return v;
  }

  private redirectUri(): string {
    const base = (process.env.API_PUBLIC_URL ?? process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
    if (!base) throw new BadRequestException('API_PUBLIC_URL não configurada.');
    return `${base}/studio-cortes/google/callback`;
  }

  // ── OAuth: state assinado (anti-tamper) ───────────────────

  private signState(orgId: string): string {
    const payload = Buffer.from(JSON.stringify({ org_id: orgId, ts: Date.now() })).toString('base64url');
    const mac = createHmac('sha256', this.requireEnv('LLM_CRED_ENCRYPTION_KEY'))
      .update(payload)
      .digest('base64url');
    return `${payload}.${mac}`;
  }

  private verifyState(state: string): string {
    const [payload, mac] = state.split('.');
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

  // ── OAuth: connect / callback ─────────────────────────────

  getAuthUrl(orgId: string): string {
    const params = new URLSearchParams({
      client_id: this.requireEnv('GOOGLE_CLIENT_ID'),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
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
      throw new InternalServerErrorException(`Google token exchange falhou: ${await res.text()}`);
    }
    const tokens = (await res.json()) as GoogleTokens;
    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'Google não retornou refresh_token. Remova o acesso em myaccount.google.com/permissions e conecte de novo.',
      );
    }

    const email = await this.fetchEmail(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const grantedScopes = (tokens.scope ?? SCOPE).split(/\s+/).filter(Boolean);

    await this.supabase.adminClient.from('cortes_drive_connections').upsert(
      {
        org_id: orgId,
        google_email: email,
        access_token: encryptApiKey(tokens.access_token),
        refresh_token: encryptApiKey(tokens.refresh_token),
        token_expires_at: expiresAt,
        scopes: grantedScopes,
        status: 'active',
        last_error: null,
      },
      { onConflict: 'org_id' },
    );

    // Garante a pasta raiz já na conexão.
    await this.ensureRootFolder(orgId);
    this.log.log(`[cortes-drive] org ${orgId} conectado como ${email}`);
    return { orgId };
  }

  private async fetchEmail(accessToken: string): Promise<string | null> {
    const res = await fetch(GOOGLE_USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    return ((await res.json()) as { email?: string }).email ?? null;
  }

  async getStatus(orgId: string): Promise<{ connected: boolean; email: string | null }> {
    const conn = await this.loadConnection(orgId);
    return { connected: Boolean(conn && conn.status === 'active'), email: conn?.google_email ?? null };
  }

  async disconnect(orgId: string): Promise<void> {
    await this.supabase.adminClient
      .from('cortes_drive_connections')
      .delete()
      .eq('org_id', orgId);
  }

  async isConfiguredForOrg(orgId: string): Promise<boolean> {
    const conn = await this.loadConnection(orgId);
    return Boolean(conn && conn.status === 'active' && conn.refresh_token);
  }

  /** True se a conexão Google da org concedeu o escopo de upload do YouTube. */
  async hasYouTubeScope(orgId: string): Promise<boolean> {
    const conn = await this.loadConnection(orgId);
    return Boolean(
      conn && conn.status === 'active' && (conn.scopes ?? []).includes(YOUTUBE_UPLOAD_SCOPE),
    );
  }

  /** Token de acesso Google válido (refresh automático) — usado pelo YouTubeShortsProvider. */
  getAccessTokenForOrg(orgId: string): Promise<string> {
    return this.getValidAccessToken(orgId);
  }

  // ── Token management ──────────────────────────────────────

  private async loadConnection(orgId: string): Promise<ConnectionRow | null> {
    const { data } = await this.supabase.adminClient
      .from('cortes_drive_connections')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle();
    return (data as ConnectionRow | null) ?? null;
  }

  private async getValidAccessToken(orgId: string): Promise<string> {
    const conn = await this.loadConnection(orgId);
    if (!conn || conn.status !== 'active' || !conn.refresh_token) {
      throw new BadRequestException('Google Drive não conectado. Conecte em Studio de Cortes.');
    }
    const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
    if (expiresAt - Date.now() > 2 * 60_000 && conn.access_token) {
      const cached = decryptApiKey(conn.access_token);
      if (cached) return cached;
    }
    // Refresh
    const refreshToken = decryptApiKey(conn.refresh_token);
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.requireEnv('GOOGLE_CLIENT_ID'),
        client_secret: this.requireEnv('GOOGLE_CLIENT_SECRET'),
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) {
      const msg = await res.text();
      await this.supabase.adminClient
        .from('cortes_drive_connections')
        .update({ status: 'error', last_error: msg.slice(0, 400) })
        .eq('org_id', orgId);
      throw new InternalServerErrorException(`Refresh do Google Drive falhou: ${msg.slice(0, 160)}`);
    }
    const t = (await res.json()) as GoogleTokens;
    await this.supabase.adminClient
      .from('cortes_drive_connections')
      .update({
        access_token: encryptApiKey(t.access_token),
        token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
        status: 'active',
        last_error: null,
      })
      .eq('org_id', orgId);
    return t.access_token;
  }

  // ── Pasta raiz + pasta do job ─────────────────────────────

  private async ensureRootFolder(orgId: string): Promise<string> {
    const conn = await this.loadConnection(orgId);
    if (conn?.root_folder_id) return conn.root_folder_id;
    const token = await this.getValidAccessToken(orgId);
    const id = await this.createFolder(token, ROOT_FOLDER_NAME, null);
    await this.supabase.adminClient
      .from('cortes_drive_connections')
      .update({ root_folder_id: id })
      .eq('org_id', orgId);
    return id;
  }

  async ensureJobFolder(orgId: string, jobId: string): Promise<string> {
    const token = await this.getValidAccessToken(orgId);
    const root = await this.ensureRootFolder(orgId);
    return this.createFolder(token, jobId, root);
  }

  private async createFolder(token: string, name: string, parentId: string | null): Promise<string> {
    const res = await fetch(`${DRIVE_API}/files?fields=id`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(`Drive mkdir falhou: ${res.status} ${(await res.text()).slice(0, 160)}`);
    }
    return ((await res.json()) as { id: string }).id;
  }

  // ── Upload / fonte / delete / cota ────────────────────────

  async uploadFile(
    orgId: string,
    folderId: string,
    fileName: string,
    content: Buffer,
    mimeType: string,
  ): Promise<DriveFile> {
    const token = await this.getValidAccessToken(orgId);
    const boundary = '----eclick-cortes-' + Buffer.from(folderId).toString('hex').slice(0, 12);
    const metadata = { name: fileName, parents: [folderId], mimeType };
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify(metadata) +
          `\r\n--${boundary}\r\n` +
          `Content-Type: ${mimeType}\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await fetch(
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': String(body.length),
        },
        body,
      },
    );
    if (!res.ok) {
      throw new InternalServerErrorException(`Drive upload falhou: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const file = (await res.json()) as DriveFile;
    this.log.log(`[cortes-drive] uploaded ${fileName} → id=${file.id}`);
    return file;
  }

  /** Torna o arquivo legível por link e devolve URL de download direto (fonte pro provedor). */
  async makeSourceUrl(orgId: string, fileId: string): Promise<string> {
    const token = await this.getValidAccessToken(orgId);
    const res = await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'anyone', role: 'reader' }),
    });
    if (!res.ok && res.status !== 409) {
      this.log.warn(`[cortes-drive] permission falhou (segue): ${res.status}`);
    }
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }

  async deleteFile(orgId: string, fileId: string): Promise<void> {
    const token = await this.getValidAccessToken(orgId);
    const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new InternalServerErrorException(`Drive delete falhou: ${res.status}`);
    }
  }

  /** Cota do Drive do usuário (5TB etc). limit null = ilimitado/desconhecido. */
  async getQuota(orgId: string): Promise<DriveQuota> {
    const token = await this.getValidAccessToken(orgId);
    const res = await fetch(`${DRIVE_API}/about?fields=storageQuota`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new InternalServerErrorException(`Drive about falhou: ${res.status}`);
    }
    const json = (await res.json()) as { storageQuota?: { limit?: string; usage?: string } };
    const limitRaw = json.storageQuota?.limit;
    const usage = Number(json.storageQuota?.usage ?? '0') || 0;
    const limit = limitRaw && limitRaw !== '0' ? Number(limitRaw) : null;
    const percent = limit && limit > 0 ? Math.round((usage / limit) * 100) : 0;
    return { limit, usage, percent };
  }
}
