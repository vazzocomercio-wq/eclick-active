import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { normalizePhoneBR, normalizeEmail } from '../normalizer';

/**
 * Collector que delega pro SaaS via bridge `/internal/enrichment/*`
 * (autenticado por X-Internal-Key).
 *
 * Endpoint criado em eclick-backend commit `4e2749c`:
 *   POST /internal/enrichment/cpf  { org_id, cpf }
 *   POST /internal/enrichment/cnpj { org_id, cnpj }
 *
 * Reusa enrichment_routing + cache + cost tracking do SaaS — não duplica
 * provedores no Active.
 *
 * Envs requeridos (active-api Railway):
 *   • SAAS_API_URL              (default: https://api.eclick.app.br)
 *   • SAAS_INTERNAL_KEY         (mesmo valor de INTERNAL_API_KEY no eclick-backend)
 *
 * Quando o SaaS retorna data.birth_date e idade<18: chama applyMinorGuard
 * via callback (caller passa pra evitar import circular).
 */

interface SaasEnrichResponse {
  success: boolean;
  quality: 'high' | 'partial' | 'error';
  data: {
    full_name?: string;
    cpf?: string;
    cnpj?: string;
    razao_social?: string;
    nome_fantasia?: string;
    birth_date?: string;
    gender?: 'M' | 'F' | 'O';
    phones?: Array<{ number: string; type?: string; whatsapp?: boolean }>;
    emails?: Array<{ email: string }>;
    addresses?: Array<Record<string, unknown>>;
    [k: string]: unknown;
  };
  provider:    string | null;
  cache_hit:   boolean;
  cost_cents:  number;
  duration_ms: number;
  error?:      string;
  attempts:    Array<{ provider: string; status: string; error?: string }>;
}

const SAAS_BASE = process.env.SAAS_API_URL?.trim() || 'https://api.eclick.app.br';

@Injectable()
export class SaasBridgeCollector {
  private readonly log = new Logger(SaasBridgeCollector.name);

  constructor(private readonly supabase: SupabaseService) {}

  private get db() {
    return this.supabase.adminClient.schema('prospect' as 'public');
  }

  private resolveKey(): string {
    const k = process.env.SAAS_INTERNAL_KEY?.trim();
    if (!k) {
      throw new ServiceUnavailableException(
        'SAAS_INTERNAL_KEY não configurada no Railway active-api.',
      );
    }
    return k;
  }

  /**
   * Enriquece CPF via SaaS bridge. Persiste contacts/signals e grava
   * raw_record com payload bruto pra provenance.
   *
   * @param onMinorDetected callback opcional — chamado se idade<18 (pra
   *   o caller invocar applyMinorGuard do ProspectService sem import
   *   circular).
   */
  async enrichCpf(
    orgId: string,
    entityId: string,
    cpf: string,
    onMinorDetected?: (birthDate: string) => Promise<void>,
  ): Promise<{
    ok: boolean;
    provider: string | null;
    cost_cents: number;
    cache_hit: boolean;
    contacts_added: number;
    minor_blocked: boolean;
    error?: string;
  }> {
    const apiKey = this.resolveKey();
    const url = `${SAAS_BASE}/internal/enrichment/cpf`;

    let body: SaasEnrichResponse;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': apiKey,
        },
        body: JSON.stringify({
          org_id: orgId,
          cpf,
          trigger_source: 'manual',
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.log.error(`[saas-bridge.cpf] HTTP ${res.status}: ${text.slice(0, 200)}`);
        return {
          ok: false,
          provider: null,
          cost_cents: 0,
          cache_hit: false,
          contacts_added: 0,
          minor_blocked: false,
          error: `bridge HTTP ${res.status}`,
        };
      }
      body = (await res.json()) as SaasEnrichResponse;
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? 'unknown';
      this.log.error(`[saas-bridge.cpf] fetch fail: ${msg}`);
      return {
        ok: false,
        provider: null,
        cost_cents: 0,
        cache_hit: false,
        contacts_added: 0,
        minor_blocked: false,
        error: msg,
      };
    }

    // Persiste raw_record só com o `data` (provider + custo entram nas colunas)
    const sourceId = this.providerToSourceId(body.provider);
    await this.db.from('raw_records').insert({
      org_id: orgId,
      source_id: sourceId ?? 'hubdev',          // fallback se provider desconhecido
      external_ref: cpf,
      payload: body.data as Record<string, unknown>,
      cost_cents: body.cost_cents ?? 0,
    });

    // ── Guard de menores ────────────────────────────────────────────
    if (body.data?.birth_date) {
      const birth = new Date(body.data.birth_date);
      if (!Number.isNaN(birth.getTime())) {
        const ageYears = (Date.now() - birth.getTime()) / (365.25 * 86400_000);
        if (ageYears < 18) {
          this.log.warn(
            `[saas-bridge.cpf] minor detected entity=${entityId} age=${Math.floor(ageYears)} — aborting enrichment`,
          );
          if (onMinorDetected) await onMinorDetected(body.data.birth_date);
          return {
            ok: true,
            provider: body.provider,
            cost_cents: body.cost_cents ?? 0,
            cache_hit: body.cache_hit,
            contacts_added: 0,
            minor_blocked: true,
          };
        }
      }
    }

    if (!body.success || body.quality === 'error') {
      return {
        ok: false,
        provider: body.provider,
        cost_cents: body.cost_cents ?? 0,
        cache_hit: body.cache_hit,
        contacts_added: 0,
        minor_blocked: false,
        error: body.error ?? 'enrichment failed',
      };
    }

    // ── Atualiza entity com nome ──────────────────────────────────
    if (body.data?.full_name) {
      await this.db
        .from('entities')
        .update({
          full_name: body.data.full_name,
          display_name: body.data.full_name,
          status: 'enriquecido',
        })
        .eq('id', entityId);
    }

    // ── contacts (phone, email) ───────────────────────────────────
    let contactsAdded = 0;
    for (const p of body.data?.phones ?? []) {
      const normalized = normalizePhoneBR(p.number);
      if (!normalized) continue;
      const ok = await this.upsertContact(entityId, p.whatsapp ? 'whatsapp' : 'phone', normalized, 75, true);
      if (ok) contactsAdded += 1;
    }
    for (const e of body.data?.emails ?? []) {
      const normalized = normalizeEmail(e.email);
      if (!normalized) continue;
      const ok = await this.upsertContact(entityId, 'email', normalized, 70, true);
      if (ok) contactsAdded += 1;
    }

    return {
      ok: true,
      provider: body.provider,
      cost_cents: body.cost_cents ?? 0,
      cache_hit: body.cache_hit,
      contacts_added: contactsAdded,
      minor_blocked: false,
    };
  }

  /** Mapeia provider do SaaS pro source_id do prospect.sources. */
  private providerToSourceId(provider: string | null): string | null {
    if (!provider) return null;
    const map: Record<string, string> = {
      hubdev: 'hubdev',
      directdata: 'directdata',
      bigdatacorp: 'bigdatacorp',
      datastone: 'datastone',
      ph3a: 'ph3a',
      viacep: 'viacep',
    };
    return map[provider.toLowerCase()] ?? null;
  }

  private async upsertContact(
    entityId: string,
    kind: 'phone' | 'whatsapp' | 'email',
    value: string,
    confidence: number,
    isPii: boolean,
  ): Promise<boolean> {
    const { data: existing } = await this.db
      .from('contacts')
      .select('id, validated_in')
      .eq('entity_id', entityId)
      .eq('kind', kind)
      .eq('value', value)
      .maybeSingle();
    if (existing) {
      const cur = existing as { id: string; validated_in: number };
      await this.db
        .from('contacts')
        .update({
          validated_in: (cur.validated_in ?? 1) + 1,
          last_validated_at: new Date().toISOString(),
        })
        .eq('id', cur.id);
      return false;
    }
    const { error } = await this.db.from('contacts').insert({
      entity_id: entityId,
      kind,
      value,
      validated_in: 1,
      confidence,
      is_pii: isPii,
      last_validated_at: new Date().toISOString(),
    });
    if (error) {
      this.log.warn(`[saas-bridge.contact] insert fail: ${error.message}`);
      return false;
    }
    return true;
  }
}
