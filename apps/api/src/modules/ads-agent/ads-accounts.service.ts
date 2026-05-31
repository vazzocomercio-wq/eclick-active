import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { AdIntegrationsService } from '../ads/ad-integrations.service';
import type { AdAccount, Platform } from './contracts/ad-provider';

export type AccountStatus = 'active' | 'paused' | 'error' | 'disconnected';
export type SpendTier = 'low' | 'standard' | 'high';
export type DecisionMode = 'copilot' | 'auto';

export interface AdsAccountRow {
  id: string;
  org_id: string;
  platform: Platform;
  external_account_id: string;
  name: string | null;
  currency: string;
  timezone: string;
  credential_ref: string;
  status: AccountStatus;
  spend_tier: SpendTier;
  decision_mode: DecisionMode;
  last_polled_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/** Cadência de polling por tier (ms) — janela mínima entre coletas. */
const TIER_CADENCE_MS: Record<SpendTier, number> = {
  high: 1 * 60 * 60 * 1000, // 1h
  standard: 3 * 60 * 60 * 1000, // 3h
  low: 6 * 60 * 60 * 1000, // 6h
};

const ACCOUNT_COLS =
  'id, org_id, platform, external_account_id, name, currency, timezone, credential_ref, status, spend_tier, decision_mode, last_polled_at, error_message, created_at, updated_at';

/**
 * CRUD + kill-switch das contas do Ads Performance Agent (active.ads_accounts).
 * Uma conta "matricula" uma ad_integration existente no motor.
 */
@Injectable()
export class AdsAccountsService {
  private readonly logger = new Logger(AdsAccountsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly integrations: AdIntegrationsService,
  ) {}

  /**
   * Matricula uma ad_integration (já conectada via OAuth) no motor.
   * credential_ref aponta pra integração — o token é resolvido sob demanda,
   * nunca copiado.
   */
  async enrollFromIntegration(
    orgId: string,
    integrationId: string,
  ): Promise<AdsAccountRow> {
    const internal = await this.integrations.getInternal(integrationId);
    if (!internal || internal.org_id !== orgId) {
      throw new NotFoundException('Integração não encontrada nesta organização.');
    }
    if (internal.status !== 'active') {
      throw new BadRequestException(
        `Integração com status "${internal.status}" — re-conecte antes de matricular no motor.`,
      );
    }

    const payload = {
      org_id: orgId,
      platform: internal.platform as Platform,
      external_account_id: internal.ad_account_id,
      name: internal.account_name,
      credential_ref: integrationId,
      status: 'active' as const,
    };

    const { data, error } = await this.supabase.adminClient
      .from('ads_accounts')
      .upsert(payload, { onConflict: 'platform,external_account_id' })
      .select(ACCOUNT_COLS)
      .single();

    if (error || !data) {
      this.logger.error(`enrollFromIntegration falhou: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Falha ao matricular conta no motor.',
      );
    }
    return data as unknown as AdsAccountRow;
  }

  async list(orgId: string): Promise<AdsAccountRow[]> {
    const { data, error } = await this.supabase.adminClient
      .from('ads_accounts')
      .select(ACCOUNT_COLS)
      .eq('org_id', orgId)
      .neq('status', 'disconnected')
      .order('created_at', { ascending: false });
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as unknown as AdsAccountRow[];
  }

  /** Carrega 1 conta garantindo a org (defesa em profundidade — service-role ignora RLS). */
  async getForOrg(orgId: string, accountId: string): Promise<AdsAccountRow> {
    const { data, error } = await this.supabase.adminClient
      .from('ads_accounts')
      .select(ACCOUNT_COLS)
      .eq('id', accountId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Conta não encontrada nesta organização.');
    return data as unknown as AdsAccountRow;
  }

  /** Carrega 1 conta sem escopo de org (uso interno — worker/ingest). */
  async getInternal(accountId: string): Promise<AdsAccountRow | null> {
    const { data, error } = await this.supabase.adminClient
      .from('ads_accounts')
      .select(ACCOUNT_COLS)
      .eq('id', accountId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    return (data as unknown as AdsAccountRow) ?? null;
  }

  /**
   * Contas que devem ser pesquisadas agora (worker). Pega ativas e filtra,
   * por tier, as cuja última coleta passou da cadência. Poucas contas no MVP
   * → filtro em memória é suficiente.
   */
  async listPollable(nowMs: number): Promise<AdsAccountRow[]> {
    const { data, error } = await this.supabase.adminClient
      .from('ads_accounts')
      .select(ACCOUNT_COLS)
      .eq('status', 'active');
    if (error) {
      this.logger.error(`listPollable falhou: ${error.message}`);
      return [];
    }
    const rows = (data ?? []) as unknown as AdsAccountRow[];
    return rows.filter((r) => {
      const cadence = TIER_CADENCE_MS[r.spend_tier] ?? TIER_CADENCE_MS.standard;
      if (!r.last_polled_at) return true;
      return nowMs - new Date(r.last_polled_at).getTime() >= cadence;
    });
  }

  /** Kill-switch / pausar / reativar (UI). */
  async setStatus(
    orgId: string,
    accountId: string,
    status: AccountStatus,
  ): Promise<AdsAccountRow> {
    await this.getForOrg(orgId, accountId); // valida posse
    const { data, error } = await this.supabase.adminClient
      .from('ads_accounts')
      .update({ status, error_message: status === 'error' ? undefined : null })
      .eq('id', accountId)
      .eq('org_id', orgId)
      .select(ACCOUNT_COLS)
      .single();
    if (error || !data) throw new InternalServerErrorException(error?.message);
    return data as unknown as AdsAccountRow;
  }

  /** Alterna copiloto ↔ auto (opt-in do modo automático). */
  async setMode(orgId: string, accountId: string, mode: DecisionMode): Promise<AdsAccountRow> {
    await this.getForOrg(orgId, accountId);
    const { data, error } = await this.supabase.adminClient
      .from('ads_accounts')
      .update({ decision_mode: mode })
      .eq('id', accountId)
      .eq('org_id', orgId)
      .select(ACCOUNT_COLS)
      .single();
    if (error || !data) throw new InternalServerErrorException(error?.message);
    return data as unknown as AdsAccountRow;
  }

  async markPolled(accountId: string): Promise<void> {
    await this.supabase.adminClient
      .from('ads_accounts')
      .update({
        last_polled_at: new Date().toISOString(),
        status: 'active',
        error_message: null,
      })
      .eq('id', accountId);
  }

  async markError(accountId: string, message: string): Promise<void> {
    await this.supabase.adminClient
      .from('ads_accounts')
      .update({ status: 'error', error_message: message.slice(0, 500) })
      .eq('id', accountId);
  }

  /** Mapeia a row do DB pro tipo canônico consumido pelos providers. */
  toAdAccount(row: AdsAccountRow): AdAccount {
    return {
      id: row.id,
      orgId: row.org_id,
      platform: row.platform,
      externalAccountId: row.external_account_id,
      credentialRef: row.credential_ref,
      currency: row.currency,
      timezone: row.timezone,
    };
  }
}
