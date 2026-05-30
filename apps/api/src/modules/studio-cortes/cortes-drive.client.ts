import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createSign } from 'node:crypto';

/**
 * Cliente do Google Drive pro Studio de Cortes. Diferente do DriveClient do
 * prospect (pasta comum), este fala com um **Shared Drive (Team Drive)** de
 * verdade — necessário pra (a) cota pertencer à org e não à Service Account e
 * (b) o monitor de cota funcionar.
 *
 * Reusa a mesma Service Account (GOOGLE_SA_KEY) — a SA precisa ser membro do
 * Shared Drive (Content Manager). Todas as chamadas levam
 * supportsAllDrives=true (exigência da API pra Shared Drives).
 *
 * Envs:
 *   GOOGLE_SA_KEY    — JSON completo da Service Account (stringified)
 *   CORTES_DRIVE_ID  — ID do Shared Drive `cortes` (driveId)
 *
 * Estrutura: {SharedDrive}/cortes/{job_id}/master.mp4
 */

interface ServiceAccountKey {
  type: 'service_account';
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
}

export interface DriveQuota {
  /** bytes; null = ilimitado/desconhecido. */
  limit: number | null;
  usage: number;
  /** 0–100; 0 se ilimitado. */
  percent: number;
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_TTL_MS = 55 * 60 * 1000;
// Params obrigatórios pra operar em Shared Drives.
const ALL_DRIVES = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

@Injectable()
export class CortesDriveClient {
  private readonly log = new Logger(CortesDriveClient.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;

  /** true se as envs estão setadas (sem validar acesso). */
  isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_SA_KEY?.trim() && process.env.CORTES_DRIVE_ID?.trim());
  }

  private resolveKey(): ServiceAccountKey {
    const raw = process.env.GOOGLE_SA_KEY?.trim();
    if (!raw) {
      throw new ServiceUnavailableException(
        'GOOGLE_SA_KEY não configurada no Railway active-api. ' +
          'Setar o JSON da Service Account com acesso ao Shared Drive de cortes.',
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

  private resolveDriveId(): string {
    const id = process.env.CORTES_DRIVE_ID?.trim();
    if (!id) {
      throw new ServiceUnavailableException(
        'CORTES_DRIVE_ID não configurada. Setar o ID do Shared Drive `cortes` no Railway active-api.',
      );
    }
    return id;
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.value;
    }
    const key = this.resolveKey();
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: key.client_email,
      scope: DRIVE_SCOPE,
      aud: key.token_uri ?? TOKEN_URI,
      iat: now,
      exp: now + 3600,
    };
    const b64url = (obj: object) =>
      Buffer.from(JSON.stringify(obj))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    const signingInput = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(claim)}`;
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
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      throw new InternalServerErrorException('Drive auth retornou sem access_token');
    }
    this.cachedToken = { value: json.access_token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return json.access_token;
  }

  /** Cria (idempotente) a sub-pasta do job dentro de /cortes no Shared Drive. */
  async ensureJobFolder(jobId: string): Promise<string> {
    const token = await this.getAccessToken();
    const driveId = this.resolveDriveId();
    const cortesRoot = await this.ensureFolder('cortes', driveId, driveId, token);
    return this.ensureFolder(jobId, cortesRoot, driveId, token);
  }

  private async ensureFolder(
    name: string,
    parentId: string,
    driveId: string,
    token: string,
  ): Promise<string> {
    const q = encodeURIComponent(
      `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    );
    const findRes = await fetch(
      `${DRIVE_API}/files?q=${q}&fields=files(id)&corpora=drive&driveId=${driveId}&${ALL_DRIVES}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (findRes.ok) {
      const { files } = (await findRes.json()) as { files?: Array<{ id: string }> };
      if (files && files.length > 0) return files[0]!.id;
    }
    const createRes = await fetch(`${DRIVE_API}/files?fields=id&${ALL_DRIVES}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        parents: [parentId],
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    if (!createRes.ok) {
      const text = await createRes.text().catch(() => '');
      throw new InternalServerErrorException(
        `Drive mkdir falhou: ${createRes.status} ${text.slice(0, 200)}`,
      );
    }
    return ((await createRes.json()) as { id: string }).id;
  }

  /** Upload do master pra pasta do job (multipart). Retorna o arquivo criado. */
  async uploadFile(
    folderId: string,
    fileName: string,
    content: Buffer,
    mimeType: string,
  ): Promise<DriveFile> {
    const token = await this.getAccessToken();
    const boundary = '-------eclick-cortes-' + Buffer.from(folderId).toString('hex').slice(0, 12);
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
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink&${ALL_DRIVES}`,
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
      const text = await res.text().catch(() => '');
      throw new InternalServerErrorException(
        `Drive upload falhou: ${res.status} ${text.slice(0, 200)}`,
      );
    }
    const file = (await res.json()) as DriveFile;
    this.log.log(`[cortes-drive] uploaded ${fileName} → id=${file.id}`);
    return file;
  }

  /**
   * Torna o arquivo legível por link e devolve uma URL de download direto, pra
   * passar como FONTE pro provedor de corte (que precisa baixar o vídeo).
   *
   * ⚠️ Drive não tem "signed URL" como o GCS. Usamos permissão anyone-reader
   * temporária + link `uc?export=download`. O Janitor apaga o master depois
   * (N dias), o que revoga o acesso. Pra arquivos grandes o Drive pode meter
   * uma página de confirmação anti-vírus; se o provedor não seguir, migrar pra
   * GCS signed URL no Sprint 2.
   */
  async makeSourceUrl(fileId: string): Promise<string> {
    const token = await this.getAccessToken();
    const res = await fetch(`${DRIVE_API}/files/${fileId}/permissions?${ALL_DRIVES}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'anyone', role: 'reader' }),
    });
    if (!res.ok && res.status !== 409) {
      const text = await res.text().catch(() => '');
      this.log.warn(`[cortes-drive] permission falhou (segue): ${res.status} ${text.slice(0, 160)}`);
    }
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }

  /** Apaga arquivo (Janitor). Idempotente — 404 não é erro. */
  async deleteFile(fileId: string): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(`${DRIVE_API}/files/${fileId}?${ALL_DRIVES}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new InternalServerErrorException(
        `Drive delete falhou: ${res.status} ${text.slice(0, 200)}`,
      );
    }
  }

  /**
   * Cota da storage pooled da org (Workspace). Em Shared Drive a cota é da org;
   * `about.storageQuota` reflete o pool quando a SA é membro do Workspace.
   * limit ausente/"0" = ilimitado → percent 0.
   */
  async getQuota(): Promise<DriveQuota> {
    const token = await this.getAccessToken();
    const res = await fetch(`${DRIVE_API}/about?fields=storageQuota`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new InternalServerErrorException(
        `Drive about falhou: ${res.status} ${text.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as {
      storageQuota?: { limit?: string; usage?: string };
    };
    const limitRaw = json.storageQuota?.limit;
    const usage = Number(json.storageQuota?.usage ?? '0') || 0;
    const limit = limitRaw && limitRaw !== '0' ? Number(limitRaw) : null;
    const percent = limit && limit > 0 ? Math.round((usage / limit) * 100) : 0;
    return { limit, usage, percent };
  }

  async healthCheck(): Promise<{ ok: boolean; sa_email: string | null; error?: string }> {
    try {
      const key = this.resolveKey();
      const driveId = this.resolveDriveId();
      const token = await this.getAccessToken();
      const res = await fetch(`${DRIVE_API}/drives/${driveId}?${ALL_DRIVES}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return {
          ok: false,
          sa_email: key.client_email,
          error: `Shared Drive inacessível (${res.status}). A SA ${key.client_email} é membro do Drive?`,
        };
      }
      return { ok: true, sa_email: key.client_email };
    } catch (e) {
      return { ok: false, sa_email: null, error: (e as Error).message };
    }
  }
}
