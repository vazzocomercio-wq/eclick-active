import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { AdIntegrationsService } from '../ad-integrations.service';
import { MetaAudienceService } from './meta-audience.service';

export interface AdAudience {
  id: string;
  org_id: string;
  integration_id: string;
  ad_account_id: string;
  external_audience_id: string | null;
  name: string;
  type: 'custom' | 'lookalike';
  source: string;
  source_filter: Record<string, unknown>;
  lookalike_source_audience_id: string | null;
  lookalike_country: string | null;
  lookalike_ratio: number | null;
  matched_count: number | null;
  approximate_count: number | null;
  status: 'pending' | 'ready' | 'error' | 'archived';
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateFromCrmDto {
  integration_id: string;
  name?: string;
  /** filtro opcional (reservado p/ tag/segmento); v1 = todos com email/phone. */
  tag?: string;
}

export interface CreateLookalikeDto {
  integration_id: string;
  /** id LOCAL (ad_audiences) do público de origem. */
  source_audience_id: string;
  name?: string;
  country?: string;
  ratio?: number;
}

const COLS =
  'id, org_id, integration_id, ad_account_id, external_audience_id, name, type, source, ' +
  'source_filter, lookalike_source_audience_id, lookalike_country, lookalike_ratio, ' +
  'matched_count, approximate_count, status, last_error, created_by, created_at, updated_at';

const MAX_CONTACTS = 50000;

/**
 * AdAudiencesService — transforma a base do CRM em públicos do Meta.
 *
 * createFromCrm: puxa active.contacts (e-mail/telefone) → cria Custom
 * Audience → sobe os contatos hasheados. createLookalike: gera Lookalike
 * a partir de um Custom já criado. PII só trafega em memória, hasheada no
 * MetaAudienceService — nada é persistido nem logado em claro.
 */
@Injectable()
export class AdAudiencesService {
  private readonly logger = new Logger(AdAudiencesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly integrations: AdIntegrationsService,
    private readonly meta: MetaAudienceService,
  ) {}

  async list(orgId: string): Promise<AdAudience[]> {
    const { data, error } = await this.supabase.adminClient
      .from('ad_audiences')
      .select(COLS)
      .eq('org_id', orgId)
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as unknown as AdAudience[];
  }

  async get(orgId: string, id: string): Promise<AdAudience> {
    const { data, error } = await this.supabase.adminClient
      .from('ad_audiences')
      .select(COLS)
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Público não encontrado.');
    return data as unknown as AdAudience;
  }

  async createFromCrm(orgId: string, userId: string, dto: CreateFromCrmDto): Promise<AdAudience> {
    const integ = await this.resolveIntegration(orgId, dto.integration_id);
    const name = dto.name?.trim() || 'CRM — contatos';

    // Cria a row pending primeiro (rastreio mesmo se o Meta falhar).
    const row = await this.insert({
      org_id: orgId,
      integration_id: dto.integration_id,
      ad_account_id: integ.ad_account_id,
      name,
      type: 'custom',
      source: 'crm_contacts',
      source_filter: dto.tag ? { tag: dto.tag } : {},
      status: 'pending',
      created_by: userId,
    });

    try {
      // Puxa contatos com e-mail OU telefone (PII só em memória).
      const { data, error } = await this.supabase.adminClient
        .from('contacts')
        .select('email, phone')
        .eq('org_id', orgId)
        .or('email.not.is.null,phone.not.is.null')
        .limit(MAX_CONTACTS);
      if (error) throw new InternalServerErrorException(error.message);

      const rows = (data ?? []) as Array<{ email: string | null; phone: string | null }>;
      if (rows.length === 0) {
        throw new BadRequestException('Nenhum contato com e-mail ou telefone no CRM.');
      }
      const emails = rows.map((r) => r.email ?? '').filter(Boolean);
      const phones = rows.map((r) => r.phone ?? '').filter(Boolean);

      const externalId = await this.meta.createCustomAudience(
        orgId, dto.integration_id, integ.ad_account_id, name,
        `e-Click · ${rows.length} contatos do CRM`,
      );
      const matched = await this.meta.addUsers(orgId, dto.integration_id, externalId, emails, phones);
      const approx = await this.meta.getApproximateCount(orgId, dto.integration_id, externalId);

      this.logger.log(`[audience] org=${orgId} custom "${name}" → ${externalId} (${matched} enviados)`);
      return this.update(orgId, row.id, {
        external_audience_id: externalId,
        matched_count: matched,
        approximate_count: approx,
        status: 'ready',
        last_error: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.update(orgId, row.id, { status: 'error', last_error: msg.slice(0, 500) });
      throw err;
    }
  }

  async createLookalike(orgId: string, userId: string, dto: CreateLookalikeDto): Promise<AdAudience> {
    const integ = await this.resolveIntegration(orgId, dto.integration_id);
    const sourceRow = await this.get(orgId, dto.source_audience_id);
    if (!sourceRow.external_audience_id) {
      throw new BadRequestException('O público de origem ainda não foi criado no Meta.');
    }
    const country = dto.country || 'BR';
    const ratio = dto.ratio ?? 0.01;
    const name = dto.name?.trim() || `Lookalike de ${sourceRow.name} (${country} ${Math.round(ratio * 100)}%)`;

    const row = await this.insert({
      org_id: orgId,
      integration_id: dto.integration_id,
      ad_account_id: integ.ad_account_id,
      name,
      type: 'lookalike',
      source: 'lookalike',
      source_filter: {},
      lookalike_source_audience_id: sourceRow.id,
      lookalike_country: country,
      lookalike_ratio: ratio,
      status: 'pending',
      created_by: userId,
    });

    try {
      const externalId = await this.meta.createLookalike(orgId, dto.integration_id, integ.ad_account_id, {
        name,
        originAudienceId: sourceRow.external_audience_id,
        country,
        ratio,
      });
      return this.update(orgId, row.id, { external_audience_id: externalId, status: 'ready', last_error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.update(orgId, row.id, { status: 'error', last_error: msg.slice(0, 500) });
      throw err;
    }
  }

  async archive(orgId: string, id: string): Promise<void> {
    await this.get(orgId, id);
    const { error } = await this.supabase.adminClient
      .from('ad_audiences')
      .update({ status: 'archived' })
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);
  }

  // ── internals ──────────────────────────────────────────────

  private async insert(payload: Record<string, unknown>): Promise<AdAudience> {
    const { data, error } = await this.supabase.adminClient
      .from('ad_audiences')
      .insert(payload)
      .select(COLS)
      .single();
    if (error || !data) throw new InternalServerErrorException(error?.message ?? 'Falha ao criar público');
    return data as unknown as AdAudience;
  }

  private async update(orgId: string, id: string, patch: Record<string, unknown>): Promise<AdAudience> {
    const { data, error } = await this.supabase.adminClient
      .from('ad_audiences')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select(COLS)
      .single();
    if (error || !data) throw new InternalServerErrorException(error?.message ?? 'Falha ao atualizar público');
    return data as unknown as AdAudience;
  }

  private async resolveIntegration(orgId: string, integrationId: string): Promise<{ ad_account_id: string }> {
    const list = await this.integrations.list(orgId);
    const found = list.find((i) => i.id === integrationId);
    if (!found) throw new NotFoundException('Conta de anúncios não encontrada nesta organização.');
    if (found.platform !== 'meta') throw new BadRequestException('Públicos só suportam contas Meta.');
    if (found.status !== 'active') {
      throw new BadRequestException(`A conta "${found.account_name ?? found.ad_account_id}" não está ativa.`);
    }
    return { ad_account_id: found.ad_account_id };
  }
}
