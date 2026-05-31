import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { AdProviderDispatcher } from './ad-provider.dispatcher';
import { AdsAccountsService, AdsAccountRow } from './ads-accounts.service';
import { AdsIngestService, IngestResult } from './ads-ingest.service';
import type { Platform } from './contracts/ad-provider';

interface EnrollBody {
  integration_id?: string;
}
interface StatusBody {
  status?: string;
}

/**
 * API do Ads Performance Agent (MVP-1, read-only + matrícula de contas).
 * Tudo escopado pela org do JWT. O motor de decisão (MVP-2+) ganha endpoints
 * próprios depois (fila de decisões, aprovar/rejeitar, KB).
 */
@UseGuards(AuthGuard)
@Controller('ads-agent')
export class AdsAgentController {
  constructor(
    private readonly accounts: AdsAccountsService,
    private readonly ingest: AdsIngestService,
    private readonly dispatcher: AdProviderDispatcher,
    private readonly supabase: SupabaseService,
  ) {}

  /** Plataformas com adaptador disponível. */
  @Get('providers')
  providers(): { platforms: Platform[] } {
    return { platforms: this.dispatcher.supported() };
  }

  /** Matricula uma ad_integration conectada no motor. */
  @Post('accounts/enroll')
  async enroll(
    @CurrentUser() user: AuthUser,
    @Body() body: EnrollBody,
  ): Promise<AdsAccountRow> {
    if (!body.integration_id) {
      throw new BadRequestException('integration_id é obrigatório.');
    }
    return this.accounts.enrollFromIntegration(user.org_id, body.integration_id);
  }

  @Get('accounts')
  listAccounts(@CurrentUser() user: AuthUser): Promise<AdsAccountRow[]> {
    return this.accounts.list(user.org_id);
  }

  @Get('accounts/:id')
  getAccount(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdsAccountRow> {
    return this.accounts.getForOrg(user.org_id, id);
  }

  /** Kill-switch / pausar / reativar uma conta no motor. */
  @Patch('accounts/:id/status')
  async setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: StatusBody,
  ): Promise<AdsAccountRow> {
    if (body.status !== 'active' && body.status !== 'paused') {
      throw new BadRequestException('status deve ser "active" ou "paused".');
    }
    return this.accounts.setStatus(user.org_id, id, body.status);
  }

  /** Coleta manual (síncrona) — útil pra testar/forçar refresh. */
  @Post('accounts/:id/sync')
  async syncNow(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<IngestResult> {
    await this.accounts.getForOrg(user.org_id, id); // valida posse
    return this.ingest.ingestAccount(id, 7);
  }

  @Get('accounts/:id/entities')
  async entities(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<unknown[]> {
    await this.accounts.getForOrg(user.org_id, id);
    const { data, error } = await this.supabase.adminClient
      .from('ads_entities')
      .select(
        'id, level, external_id, parent_id, name, objective, status, budget_cents, budget_type, synced_at',
      )
      .eq('account_id', id)
      .eq('org_id', user.org_id)
      .order('synced_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  @Get('accounts/:id/insights')
  async insights(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('days') days?: string,
  ): Promise<unknown[]> {
    await this.accounts.getForOrg(user.org_id, id);
    const daysBack = Math.min(Math.max(Number(days) || 30, 1), 365);
    const since = new Date(Date.now() - daysBack * 86400_000)
      .toISOString()
      .slice(0, 10);

    // entities da conta → insights dessas entities na janela
    const { data: ents, error: entErr } = await this.supabase.adminClient
      .from('ads_entities')
      .select('id')
      .eq('account_id', id)
      .eq('org_id', user.org_id);
    if (entErr) throw new BadRequestException(entErr.message);
    const entityIds = ((ents ?? []) as Array<{ id: string }>).map((e) => e.id);
    if (entityIds.length === 0) return [];

    const { data, error } = await this.supabase.adminClient
      .from('ads_insights')
      .select(
        'entity_id, level, date, spend_cents, impressions, clicks, conversions, revenue_cents, cpa_cents, roas, ctr, cpm_cents',
      )
      .in('entity_id', entityIds)
      .gte('date', since)
      .order('date', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}
