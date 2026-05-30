import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { AdIntegrationsService } from '../ad-integrations.service';

const API_VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;
const USERS_CHUNK = 10000; // limite do Meta por chamada

/**
 * MetaAudienceService — camada de ESCRITA de Públicos na Marketing API.
 *
 * Cria Custom Audiences (1st-party, a partir do CRM) e Lookalikes. Os
 * e-mails/telefones são NORMALIZADOS + hasheados em SHA256 aqui e enviados
 * já hasheados — PII crua nunca sai do servidor nem vai pra log.
 */
@Injectable()
export class MetaAudienceService {
  private readonly logger = new Logger(MetaAudienceService.name);

  constructor(private readonly integrations: AdIntegrationsService) {}

  /** Cria um Custom Audience vazio (USER_PROVIDED_ONLY). Retorna o id. */
  async createCustomAudience(
    orgId: string,
    integrationId: string,
    accountId: string,
    name: string,
    description?: string,
  ): Promise<string> {
    const token = await this.integrations.getAccessToken(orgId, integrationId);
    const json = await this.post<{ id?: string }>(`${GRAPH}/${acct(accountId)}/customaudiences`, {
      name,
      description: description ?? 'Criado pelo e-Click a partir do CRM',
      subtype: 'CUSTOM',
      customer_file_source: 'USER_PROVIDED_ONLY',
      access_token: token,
    });
    if (!json.id) throw new BadRequestException('Meta não retornou id do público.');
    return json.id;
  }

  /**
   * Adiciona usuários ao público. Recebe e-mails/telefones CRUS, normaliza
   * e hasheia (SHA256) antes de enviar. Retorna quantos registros subiram.
   */
  async addUsers(
    orgId: string,
    integrationId: string,
    audienceId: string,
    emails: string[],
    phones: string[],
  ): Promise<number> {
    const token = await this.integrations.getAccessToken(orgId, integrationId);

    const emailHashes = dedupe(emails.map(normEmail).filter(Boolean) as string[]).map(sha256);
    const phoneHashes = dedupe(phones.map(normPhone).filter(Boolean) as string[]).map(sha256);

    let sent = 0;
    sent += await this.pushSchema(token, audienceId, 'EMAIL', emailHashes);
    sent += await this.pushSchema(token, audienceId, 'PHONE', phoneHashes);
    return sent;
  }

  /** Cria um Lookalike a partir de um Custom Audience de origem. */
  async createLookalike(
    orgId: string,
    integrationId: string,
    accountId: string,
    args: { name: string; originAudienceId: string; country: string; ratio: number },
  ): Promise<string> {
    const token = await this.integrations.getAccessToken(orgId, integrationId);
    const ratio = Math.min(0.2, Math.max(0.01, args.ratio || 0.01));
    const json = await this.post<{ id?: string }>(`${GRAPH}/${acct(accountId)}/customaudiences`, {
      name: args.name,
      subtype: 'LOOKALIKE',
      origin_audience_id: args.originAudienceId,
      lookalike_spec: JSON.stringify({
        type: 'similarity',
        country: args.country || 'BR',
        ratio,
      }),
      access_token: token,
    });
    if (!json.id) throw new BadRequestException('Meta não retornou id do lookalike.');
    return json.id;
  }

  /** Estimativa de alcance/contagem do público (best-effort). */
  async getApproximateCount(
    orgId: string,
    integrationId: string,
    audienceId: string,
  ): Promise<number | null> {
    try {
      const token = await this.integrations.getAccessToken(orgId, integrationId);
      const json = await this.get<{ approximate_count_lower_bound?: number; approximate_count?: number }>(
        `${GRAPH}/${audienceId}?fields=approximate_count_lower_bound,approximate_count&access_token=${encodeURIComponent(token)}`,
      );
      return json.approximate_count_lower_bound ?? json.approximate_count ?? null;
    } catch {
      return null;
    }
  }

  // ── internals ────────────────────────────────────────────────

  private async pushSchema(
    token: string,
    audienceId: string,
    schema: 'EMAIL' | 'PHONE',
    hashes: string[],
  ): Promise<number> {
    let sent = 0;
    for (let i = 0; i < hashes.length; i += USERS_CHUNK) {
      const chunk = hashes.slice(i, i + USERS_CHUNK);
      if (!chunk.length) continue;
      await this.post(`${GRAPH}/${audienceId}/users`, {
        payload: JSON.stringify({ schema: [schema], data: chunk.map((h) => [h]) }),
        access_token: token,
      });
      sent += chunk.length;
    }
    return sent;
  }

  private async get<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw await this.err(res);
    return (await res.json()) as T;
  }

  private async post<T>(url: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.err(res);
    return (await res.json()) as T;
  }

  private async err(res: Response): Promise<BadRequestException> {
    const text = await res.text();
    let msg = text.slice(0, 300);
    try {
      const p = JSON.parse(text) as { error?: { error_user_msg?: string; message?: string } };
      msg = p.error?.error_user_msg ?? p.error?.message ?? msg;
    } catch {
      /* não-JSON */
    }
    return new BadRequestException(`Meta recusou (${res.status}): ${msg}`);
  }
}

// ── helpers de normalização/hash (PII) ──────────────────────────

/** Garante o prefixo act_ no id da conta. */
function acct(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
}
function sha256(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}
function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}
function normEmail(e: string | null | undefined): string | null {
  if (!e) return null;
  const t = e.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t) ? t : null;
}
/** Normaliza telefone BR pra E.164 sem '+': só dígitos, com DDI 55. */
function normPhone(p: string | null | undefined): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 11) d = `55${d}`; // assume BR se veio sem DDI
  return d.length >= 12 && d.length <= 15 ? d : null;
}
