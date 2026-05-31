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
import { AdsAnalyzeService, AnalyzeResult } from './analysis/ads-analyze.service';
import { AdsDossierService, AccountDossier } from './analysis/ads-dossier.service';
import { AdsOverviewService, AdsOverview } from './ads-overview.service';
import {
  AdsDecisionsService,
  DecisionRow,
  DecisionStatus,
} from './ads-decisions.service';
import { AdsApplyService } from './ads-apply.service';
import { AdsOutcomeService } from './ads-outcome.service';
import type { Platform } from './contracts/ad-provider';

interface EnrollBody {
  integration_id?: string;
}
interface StatusBody {
  status?: string;
}
interface ModeBody {
  mode?: string;
}
interface EditBudgetBody {
  after_budget_brl?: number;
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
    private readonly analyze: AdsAnalyzeService,
    private readonly decisions: AdsDecisionsService,
    private readonly overview: AdsOverviewService,
    private readonly dossiers: AdsDossierService,
    private readonly applier: AdsApplyService,
    private readonly outcomes: AdsOutcomeService,
  ) {}

  /** Plataformas com adaptador disponível. */
  @Get('providers')
  providers(): { platforms: Platform[] } {
    return { platforms: this.dispatcher.supported() };
  }

  /** KPIs agregados (hero + grid de contas) numa chamada só. */
  @Get('overview')
  overviewKpis(@CurrentUser() user: AuthUser): Promise<AdsOverview> {
    return this.overview.getOverview(user.org_id);
  }

  /** Campanhas de uma conta com métricas agregadas (dossiê, em BRL). */
  @Get('accounts/:id/campaigns')
  async campaigns(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AccountDossier | { account_id: string; platform: string; currency: string; entities: [] }> {
    await this.accounts.getForOrg(user.org_id, id);
    const dossier = await this.dossiers.buildAccountDossier(id);
    return dossier ?? { account_id: id, platform: 'meta', currency: 'BRL', entities: [] };
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

  /** Alterna o modo de decisão da conta (copilot ↔ auto). */
  @Patch('accounts/:id/mode')
  setMode(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ModeBody,
  ): Promise<AdsAccountRow> {
    if (body.mode !== 'copilot' && body.mode !== 'auto') {
      throw new BadRequestException('mode deve ser "copilot" ou "auto".');
    }
    return this.accounts.setMode(user.org_id, id, body.mode);
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

  // ── ANALYZE + fila de decisões (MVP-2, copiloto) ───────────

  /** Roda a análise IA agora (síncrono) → grava sugestões pendentes. */
  @Post('accounts/:id/analyze')
  async analyzeNow(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AnalyzeResult> {
    await this.accounts.getForOrg(user.org_id, id); // valida posse
    return this.analyze.analyzeAccount(id);
  }

  /** Fila de decisões. ?status=pending|approved|rejected|... (default pending). */
  @Get('decisions')
  listDecisions(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
  ): Promise<DecisionRow[]> {
    const s = (status as DecisionStatus) || 'pending';
    return this.decisions.list(user.org_id, { status: s });
  }

  @Get('decisions/:id')
  getDecision(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DecisionRow> {
    return this.decisions.get(user.org_id, id);
  }

  /** Aprovar = APLICAR de verdade no provedor (com guardrails). */
  @Post('decisions/:id/approve')
  approveDecision(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ id: string; status: string; message: string }> {
    return this.applier.apply(user.org_id, id);
  }

  /** Reverte uma decisão já aplicada ao estado anterior. */
  @Post('decisions/:id/rollback')
  rollbackDecision(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ id: string; status: string; message: string }> {
    return this.applier.rollback(user.org_id, id);
  }

  @Post('decisions/:id/reject')
  rejectDecision(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DecisionRow> {
    return this.decisions.reject(user.org_id, id);
  }

  /** Edita o orçamento proposto (drag na UI) antes de aprovar. */
  @Patch('decisions/:id')
  editDecision(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: EditBudgetBody,
  ): Promise<DecisionRow> {
    if (typeof body.after_budget_brl !== 'number') {
      throw new BadRequestException('after_budget_brl (número) é obrigatório.');
    }
    return this.decisions.editAfterBudget(user.org_id, id, body.after_budget_brl);
  }

  // ── Outcomes (loop de aprendizado, MVP-3b) ─────────────────

  /** Mede agora os outcomes vencidos (manual/teste; o worker faz @1h). */
  @Post('outcomes/run')
  runOutcomes(): Promise<{ measured: number }> {
    return this.outcomes.measureDue();
  }

  /** Outcomes recentes da org. */
  @Get('outcomes')
  async listOutcomes(@CurrentUser() user: AuthUser): Promise<unknown[]> {
    const { data, error } = await this.supabase.adminClient
      .from('ads_outcomes')
      .select('id, decision_id, window_hours, before_metrics, after_metrics, delta, verdict, measured_at')
      .eq('org_id', user.org_id)
      .order('measured_at', { ascending: false })
      .limit(50);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}
