import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { DashboardService, type DashboardSummary } from './dashboard.service';

@UseGuards(AuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('summary')
  getSummary(@CurrentUser() user: AuthUser): Promise<DashboardSummary> {
    return this.service.getSummary(user.org_id);
  }
}
