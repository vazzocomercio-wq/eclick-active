import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createSign } from 'node:crypto';

/**
 * Cliente do Google Drive — usado pelo CNPJ Data Lake pra escrever/ler
 * dumps gigantes (Receita Aberta + portais governamentais).
 *
 * Auth: Service Account via JWT (RFC 7519). NÃO depende de OAuth flow
 * porque é background job. Reusa padrão do calendar-integrations (REST
 * direto, sem dependência do SDK googleapis).
 *
 * Envs:
 *   GOOGLE_SA_KEY         — JSON completo da Service Account key (stringified)
 *   DRIVE_LAKE_FOLDER_ID  — ID da pasta `eclick-cnpj-lake` no Drive
 *
 * Setup necessário ANTES de usar:
 *   1. Criar SA no GCP (já feito 2026-05-28: eclick-cnpj-lake@eclick-prospect.iam)
 *   2. Habilitar Google Drive API no projeto (já feito)
 *   3. Gerar key JSON da SA (etapa manual do user)
 *   4. Criar pasta no Drive + compartilhar com SA como Editor
 *   5. Setar GOOGLE_SA_KEY + DRIVE_LAKE_FOLDER_ID no Railway active-api
 */

interface ServiceAccountKey {
  type: 'service_account';
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  token_uri?: string;
}

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  createdTime?: string;
  modifiedTime?: string;
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
// Token tem TTL 1h. Renovamos 5min antes pra dar margem.
const TOKEN_TTL_MS = 55 * 60 * 1000;

@Injectable()
export class DriveClient {
  private readonly log = new Logger(DriveClient.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;

  private resolveKey(): ServiceAccountKey {
    const raw = process.env.GOOGLE_SA_KEY?.trim();
    if (!raw) {
      throw new ServiceUnavailableException(
        'GOOGLE_SA_KEY não configurada no Railway active-api. ' +
          'Setar JSON completo da Service Account `eclick-cnpj-lake`.',
      );
    }
    try {
      return JSON.parse(raw) as ServiceAccountKey;
    } catch (e) {
      throw new InternalServerErrorException(
        `GOOGLE_SA_KEY inválida (não é JSON): ${(e as Error).message}`,
      );
    }
  }

  private resolveLakeFolderId(): string {
    const id = process.env.DRIVE_LAKE_FOLDER_ID?.trim();
    if (!id) {
      throw new ServiceUnavailableException(
        'DRIVE_LAKE_FOLDER_ID não configurada. Setar ID da pasta eclick-cnpj-lake no Drive.',
      );
    }
    return id;
  }

  /**
   * Pega access_token. Cache em memória 55min (TTL do Google é 60min).
   * Renovação on-demand quando expira.
   */
  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.value;
    }

    const key = this.resolveKey();
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss:   key.client_email,
      scope: DRIVE_SCOPE,
      aud:   key.token_uri ?? TOKEN_URI,
      iat:   now,
      exp:   now + 3600,
    };

    // Assina JWT RS256
    const header = { alg: 'RS256', typ: 'JWT' };
    const b64url = (obj: object) =>
      Buffer.from(JSON.stringify(obj))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    const headerB64 = b64url(header);
    const claimB64  = b64url(claim);
    const signingInput = `${headerB64}.${claimB64}`;

    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    const signature = signer
      .sign(key.private_key)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const assertion = `${signingInput}.${signature}`;

    // Troca JWT por access_token
    const res = await fetch(key.token_uri ?? TOKEN_URI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new InternalServerErrorException(
        `Drive auth falhou (HTTP ${res.status}): ${text.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    if (!json.access_token) {
      throw new InternalServerErrorException('Drive auth retornou sem access_token');
    }

    this.cachedToken = {
      value: json.access_token,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    };
    this.log.log(`[drive] access_token cached (TTL ~55min)`);
    return json.access_token;
  }

  /**
   * Lista arquivos da pasta lake (raiz ou sub-pasta).
   * Não pagina ainda — pra DL.1 MVP, pageSize=100 é suficiente
   * (lake terá ~12 dumps por ano).
   */
  async list(opts?: { parentId?: string; pageSize?: number }): Promise<DriveFileMetadata[]> {
    const token = await this.getAccessToken();
    const parent = opts?.parentId ?? this.resolveLakeFolderId();
    const params = new URLSearchParams({
      q: `'${parent}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,size,webViewLink,createdTime,modifiedTime)',
      pageSize: String(opts?.pageSize ?? 100),
      orderBy: 'modifiedTime desc',
    });
    const res = await fetch(`${DRIVE_API}/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new InternalServerErrorException(`Drive list falhou: ${res.status} ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { files?: DriveFileMetadata[] };
    return json.files ?? [];
  }

  /**
   * Upload de arquivo pra pasta lake.
   * @param fileName nome do arquivo (ex: "receita-2026-05.parquet")
   * @param content Buffer ou stream
   * @param mimeType default application/octet-stream
   * @param parentId default = lake folder
   *
   * Usa multipart upload (Google Drive API v3) — bom até ~5MB. Pra
   * arquivos maiores (dumps Receita ~5GB) precisa upload resumable
   * (TODO: DL.2 implementa quando precisar de verdade).
   */
  async upload(
    fileName: string,
    content: Buffer,
    mimeType = 'application/octet-stream',
    parentId?: string,
  ): Promise<DriveFileMetadata> {
    const token = await this.getAccessToken();
    const parent = parentId ?? this.resolveLakeFolderId();

    const boundary = '-------eclick-' + Math.random().toString(36).slice(2);
    const metadata = {
      name: fileName,
      parents: [parent],
      mimeType,
    };

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

    const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new InternalServerErrorException(`Drive upload falhou: ${res.status} ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as DriveFileMetadata;
    this.log.log(`[drive] uploaded ${fileName} → id=${json.id} size=${json.size ?? '?'}b`);
    return json;
  }

  /** Download de arquivo por ID. Retorna Buffer (pra arquivos médios). */
  async download(fileId: string): Promise<Buffer> {
    const token = await this.getAccessToken();
    const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new InternalServerErrorException(`Drive download falhou: ${res.status} ${text.slice(0, 200)}`);
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  /**
   * Debug: lista TUDO que a SA enxerga (sem filtro de parents).
   * Útil pra confirmar se a SA tem acesso a alguma pasta (e qual o ID real).
   */
  async listAllVisible(): Promise<DriveFileMetadata[]> {
    const token = await this.getAccessToken();
    const params = new URLSearchParams({
      fields: 'files(id,name,mimeType,owners(emailAddress),webViewLink,modifiedTime)',
      pageSize: '50',
      orderBy: 'modifiedTime desc',
    });
    const res = await fetch(`${DRIVE_API}/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new InternalServerErrorException(`Drive listAll falhou: ${res.status} ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { files?: DriveFileMetadata[] };
    return json.files ?? [];
  }

  /** Apaga arquivo (cleanup de dumps antigos). */
  async delete(fileId: string): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new InternalServerErrorException(`Drive delete falhou: ${res.status} ${text.slice(0, 200)}`);
    }
  }

  /**
   * Health check — usado em "/prospect/admin/drive/health" pra confirmar
   * que key+folder estão setados E a SA tem acesso ao folder.
   */
  async healthCheck(): Promise<{
    ok: boolean;
    folder_accessible: boolean;
    sa_email: string | null;
    files_count: number;
    error?: string;
  }> {
    try {
      const key = this.resolveKey();
      const folderId = this.resolveLakeFolderId();
      const token = await this.getAccessToken();

      // GET na pasta verifica acesso (a SA precisa estar compartilhada como Editor)
      const res = await fetch(`${DRIVE_API}/files/${folderId}?fields=id,name`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return {
          ok: false,
          folder_accessible: false,
          sa_email: key.client_email,
          files_count: 0,
          error: `Pasta inacessível (${res.status}). A SA ${key.client_email} foi compartilhada como Editor?`,
        };
      }
      const files = await this.list();
      return {
        ok: true,
        folder_accessible: true,
        sa_email: key.client_email,
        files_count: files.length,
      };
    } catch (e) {
      return {
        ok: false,
        folder_accessible: false,
        sa_email: null,
        files_count: 0,
        error: (e as Error).message,
      };
    }
  }
}
