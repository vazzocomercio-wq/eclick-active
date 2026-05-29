import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { ReceitaDumpService } from './receita-dump.service';

/**
 * Endpoints administrativos do CNPJ Data Lake — DL.2+.
 *
 * Vai virar parte do `/dashboard/admin/prospect-lake` na UI (DL.8 inclui).
 */
@UseGuards(AuthGuard)
@Controller('prospect/admin/lake')
export class ProspectLakeController {
  constructor(private readonly receitaDump: ReceitaDumpService) {}

  /**
   * Dispara worker DL.2.a — detector + manifest.
   * Body opcional: { month?: "YYYY-MM" } pra forçar mês específico.
   */
  @Post('run-receita')
  async runReceita(@Body() body?: { month?: string }) {
    return this.receitaDump.runDL2a(body?.month);
  }

  /** Lista runs recentes do lake. */
  @Get('runs')
  listRuns(@Query('limit') limit?: string) {
    return this.receitaDump.listRuns(limit ? Number(limit) : 20);
  }
}
