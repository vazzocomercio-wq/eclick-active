import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  ReportsService,
  type AgentReport,
  type ChannelReport,
  type FunnelReport,
  type InterpretResult,
  type SalesReport,
} from './reports.service';
import { PeriodQueryDto } from './dto/period.query.dto';
import { InterpretReportDto } from './dto/interpret.dto';

@UseGuards(AuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('sales')
  sales(
    @CurrentUser() user: AuthUser,
    @Query() period: PeriodQueryDto,
  ): Promise<SalesReport> {
    return this.service.getSalesReport(user.org_id, period);
  }

  @Get('agents')
  agents(
    @CurrentUser() user: AuthUser,
    @Query() period: PeriodQueryDto,
  ): Promise<AgentReport> {
    return this.service.getAgentReport(user.org_id, period);
  }

  @Get('channels')
  channels(
    @CurrentUser() user: AuthUser,
    @Query() period: PeriodQueryDto,
  ): Promise<ChannelReport> {
    return this.service.getChannelReport(user.org_id, period);
  }

  @Get('funnel/:pipelineId')
  funnel(
    @CurrentUser() user: AuthUser,
    @Param('pipelineId', ParseUUIDPipe) pipelineId: string,
    @Query() period: PeriodQueryDto,
  ): Promise<FunnelReport> {
    return this.service.getFunnelReport(user.org_id, pipelineId, period);
  }

  @Post('interpret')
  @HttpCode(HttpStatus.OK)
  interpret(
    @CurrentUser() user: AuthUser,
    @Body() dto: InterpretReportDto,
  ): Promise<InterpretResult> {
    return this.service.interpretReport(
      user.org_id,
      user.id,
      dto.report_type,
      dto.data,
    );
  }
}
