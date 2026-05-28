import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { ProspectService } from './prospect.service';
import type {
  CollectDto,
  DiscoverPlacesDto,
  EnrichDto,
  ListEntitiesQuery,
  PromoteDto,
  ResolveMatchDto,
} from './prospect.types';

/**
 * e-Click Prospect — endpoints autenticados.
 *
 * Auth: AuthGuard valida JWT Supabase, popula `user.org_id` e `user.id`.
 * Todo método filtra por `user.org_id` no service (service_role bypassa RLS).
 */
@UseGuards(AuthGuard)
@Controller('prospect')
export class ProspectController {
  constructor(private readonly svc: ProspectService) {}

  /** Dispara coleta (PJ via CNPJ; PF bloqueado — coleta fria proibida). */
  @Post('collect')
  collect(@CurrentUser() user: AuthUser, @Body() body: CollectDto) {
    return this.svc.collect(user.org_id, body);
  }

  /** Descobre PJs por busca textual no Google Places. Cria entidades sem CNPJ
   *  (S5 entity_resolver vai casar com Receita depois). */
  @Post('discover/places')
  discoverPlaces(
    @CurrentUser() user: AuthUser,
    @Body() body: DiscoverPlacesDto,
  ) {
    return this.svc.discoverPlaces(user.org_id, body);
  }

  /** Lista entidades com filtros (score, sinais, status, tipo). */
  @Get('entities')
  list(@CurrentUser() user: AuthUser, @Query() query: ListEntitiesQuery) {
    return this.svc.list(user.org_id, {
      ...query,
      min_score: query.min_score ? Number(query.min_score) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  /** Perfil-mestre + contatos + sinais + consent + provenance. */
  @Get('entities/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getProfile(user.org_id, id);
  }

  /** Força re-resolução (gera embedding + busca similares + auto-merge ≥90 ou
   *  fila match_review 80–89). */
  @Post('entities/:id/resolve')
  resolve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.resolveEntity(user.org_id, id);
  }

  /** Força recálculo do prospect_score (lê signals + entity → atualiza score
   *  e status se cruzou corte ≥70). Retorna o breakdown auditável. */
  @Post('entities/:id/score')
  score(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.scoreEntity(user.org_id, id);
  }

  /** Re-score em lote pra org inteira (admin / depois de ajuste de pesos). */
  @Post('rescore')
  rescore(
    @CurrentUser() user: AuthUser,
    @Body() body: { status?: string[] },
  ) {
    return this.svc.rescoreOrg(user.org_id, body?.status);
  }

  /** Força próxima camada de enrichment (respeita gates Corte_1 / Corte_2). */
  @Post('entities/:id/enrich')
  enrich(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: EnrichDto,
  ) {
    return this.svc.enrich(user.org_id, id, body);
  }

  /** Promove pro Active (passa compliance gate). */
  @Post('entities/:id/promote')
  promote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PromoteDto,
  ) {
    return this.svc.promote(user.org_id, id, body);
  }

  /** Registra opt-out interno (operador da org). */
  @Post('entities/:id/opt-out')
  optOut(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.svc.optOutInternal(user.org_id, id, body?.reason);
  }

  /** Fila de revisão humana (matches 0.80–0.90). */
  @Get('match-review')
  matchReview(@CurrentUser() user: AuthUser) {
    return this.svc.listMatchReview(user.org_id);
  }

  /** Resolve um item da fila (merge | reject). */
  @Post('match-review/:id/resolve')
  resolveMatch(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ResolveMatchDto,
  ) {
    return this.svc.resolveMatch(user.org_id, id, user.id, body);
  }

  /** Relatório de CAC por fonte. */
  @Get('reports/cac')
  cac(@CurrentUser() user: AuthUser) {
    return this.svc.cacReport(user.org_id);
  }
}
