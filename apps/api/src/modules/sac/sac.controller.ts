import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  ParseIntPipe,
  ParseUUIDPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RateLimit } from '../../common/guards/rate-limit.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { SacTicketsService } from './sac-tickets.service';
import { SacAiService } from './sac-ai.service';
import { SacSlaService } from './sac-sla.service';
import { SacTemplatesService } from './sac-templates.service';
import { SacPreventiveService } from './sac-preventive.service';
import type {
  SacListFilters,
  SacStatus,
  SacPriority,
  SacCategory,
  SacReputationRisk,
} from './sac.types';
import { CreateTicketDto } from './dto/create-ticket.dto';
import {
  UpdateTicketDto,
  AssignTicketDto,
  EscalateTicketDto,
} from './dto/update-ticket.dto';
import {
  ResolveTicketDto,
  ReopenTicketDto,
  RateTicketDto,
  AddNoteDto,
  LinkOrderDto,
} from './dto/resolve-ticket.dto';
import { CreateSlaRuleDto, UpdateSlaRuleDto } from './dto/sla-rule.dto';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { ClassifyDto, PerformanceDto } from './dto/ai.dto';

// Papéis que podem administrar configuração de SAC (regras de SLA, templates)
// e disparar operações pesadas (scan preventivo). Agentes/viewers ficam de fora.
const SAC_ADMIN_ROLES = ['owner', 'admin', 'manager'] as const;

@UseGuards(AuthGuard, RolesGuard, RateLimitGuard)
@Controller('sac')
export class SacController {
  constructor(
    private readonly tickets: SacTicketsService,
    private readonly ai: SacAiService,
    private readonly sla: SacSlaService,
    private readonly templates: SacTemplatesService,
    private readonly preventive: SacPreventiveService,
  ) {}

  // ─── Tickets ────────────────────────────────────

  @Get('tickets')
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('category') category?: string,
    @Query('assigned_to') assignedTo?: string,
    @Query('sla_breached') slaBreached?: string,
    @Query('reputation_risk_min') riskMin?: string,
    @Query('channel_type') channelType?: string,
    @Query('has_order') hasOrder?: string,
    @Query('is_preventive') isPreventive?: string,
    @Query('search') search?: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('page_size', new DefaultValuePipe(25), ParseIntPipe) pageSize?: number,
  ) {
    const filters: SacListFilters = {
      status: status ? (status.split(',') as SacStatus[]) : undefined,
      priority: priority ? (priority.split(',') as SacPriority[]) : undefined,
      category: category ? (category.split(',') as SacCategory[]) : undefined,
      assigned_to: assignedTo,
      sla_breached:
        slaBreached === 'true'
          ? true
          : slaBreached === 'false'
            ? false
            : undefined,
      reputation_risk_min: riskMin as SacReputationRisk | undefined,
      channel_type: channelType,
      has_order:
        hasOrder === 'true'
          ? true
          : hasOrder === 'false'
            ? false
            : undefined,
      is_preventive:
        isPreventive === 'true'
          ? true
          : isPreventive === 'false'
            ? false
            : undefined,
      search,
      date_from: dateFrom,
      date_to: dateTo,
      page,
      page_size: pageSize,
    };
    return this.tickets.findAll(user.org_id, filters);
  }

  @Post('tickets')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.tickets.create(user.org_id, dto, user.id);
  }

  @Get('tickets/dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.tickets.getDashboardCounts(user.org_id);
  }

  @Get('tickets/by-conversation/:conversationId')
  byConversation(
    @CurrentUser() user: AuthUser,
    @Param('conversationId') conversationId: string,
  ) {
    return this.tickets.getByConversation(user.org_id, conversationId);
  }

  @Get('tickets/by-contact/:contactId')
  byContact(
    @CurrentUser() user: AuthUser,
    @Param('contactId') contactId: string,
  ) {
    return this.tickets.getByContact(user.org_id, contactId);
  }

  @Get('tickets/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tickets.findById(user.org_id, id);
  }

  @Patch('tickets/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.tickets.update(user.org_id, id, dto);
  }

  @Post('tickets/:id/assign')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AssignTicketDto,
  ) {
    return this.tickets.assign(user.org_id, id, dto);
  }

  @Post('tickets/:id/escalate')
  escalate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: EscalateTicketDto,
  ) {
    return this.tickets.escalate(user.org_id, id, dto);
  }

  @Post('tickets/:id/resolve')
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveTicketDto,
  ) {
    return this.tickets.resolve(user.org_id, id, dto);
  }

  @Post('tickets/:id/reopen')
  reopen(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReopenTicketDto,
  ) {
    return this.tickets.reopen(user.org_id, id, dto);
  }

  @Post('tickets/:id/note')
  addNote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddNoteDto,
  ) {
    return this.tickets.addNote(user.org_id, id, dto, user.id);
  }

  @Post('tickets/:id/link-order')
  linkOrder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: LinkOrderDto,
  ) {
    return this.tickets.linkOrder(user.org_id, id, dto);
  }

  @Post('tickets/:id/rate')
  rate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RateTicketDto,
  ) {
    return this.tickets.rateSatisfaction(user.org_id, id, dto);
  }

  @Get('tickets/:id/actions')
  actions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tickets.getActions(user.org_id, id);
  }

  // ─── SLA ────────────────────────────────────────

  @Get('sla/stats')
  slaStats(
    @CurrentUser() user: AuthUser,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days?: number,
  ) {
    return this.sla.getStats(user.org_id, days ?? 30);
  }

  @Get('sla/rules')
  listRules(@CurrentUser() user: AuthUser) {
    return this.sla.listRules(user.org_id);
  }

  @Post('sla/rules')
  @Roles(...SAC_ADMIN_ROLES)
  createRule(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSlaRuleDto,
  ) {
    return this.sla.createRule(user.org_id, dto);
  }

  @Patch('sla/rules/:id')
  @Roles(...SAC_ADMIN_ROLES)
  updateRule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSlaRuleDto,
  ) {
    return this.sla.updateRule(user.org_id, id, dto);
  }

  @Delete('sla/rules/:id')
  @Roles(...SAC_ADMIN_ROLES)
  deleteRule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sla.deleteRule(user.org_id, id);
  }

  // ─── Templates ──────────────────────────────────

  @Get('templates')
  listTemplates(
    @CurrentUser() user: AuthUser,
    @Query('category') category?: string,
  ) {
    return this.templates.list(user.org_id, category);
  }

  @Post('templates')
  @Roles(...SAC_ADMIN_ROLES)
  createTemplate(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTemplateDto,
  ) {
    return this.templates.create(user.org_id, user.id, dto);
  }

  @Patch('templates/:id')
  @Roles(...SAC_ADMIN_ROLES)
  updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templates.update(user.org_id, id, dto);
  }

  @Delete('templates/:id')
  @Roles(...SAC_ADMIN_ROLES)
  deleteTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.delete(user.org_id, id);
  }

  // ─── AI ─────────────────────────────────────────

  @Post('ai/classify')
  @RateLimit(30, 60_000)
  classify(
    @CurrentUser() user: AuthUser,
    @Body() dto: ClassifyDto,
  ) {
    return this.ai.classifyTicket(
      user.org_id,
      dto.message,
      dto.history ?? [],
      { phone: dto.phone, email: dto.email },
    );
  }

  @Post('ai/suggest/:ticketId')
  @RateLimit(30, 60_000)
  suggest(
    @CurrentUser() user: AuthUser,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.ai.suggestResponse(user.org_id, ticketId);
  }

  @Post('ai/performance')
  @RateLimit(10, 5 * 60_000)
  performance(
    @CurrentUser() user: AuthUser,
    @Body() dto: PerformanceDto,
  ) {
    return this.ai.analyzePerformance(user.org_id, dto.period ?? 'week');
  }

  // ─── Preventivo (manual trigger) ────────────────

  @Post('preventive/run')
  @Roles(...SAC_ADMIN_ROLES)
  @RateLimit(3, 10 * 60_000)
  runPreventive(@CurrentUser() user: AuthUser) {
    return this.preventive.runScanForOrg(user.org_id);
  }
}
