import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { ReEngagementService } from './re-engagement.service';

class UpdateReEngagementSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  days_threshold?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  max_retries?: number;

  @IsOptional()
  @IsBoolean()
  only_with_open_deal?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  min_advance_days_between?: number;
}

@Controller('re-engagement')
@UseGuards(AuthGuard)
export class ReEngagementController {
  constructor(private readonly service: ReEngagementService) {}

  @Get('settings')
  getSettings(@CurrentUser() user: AuthUser) {
    return this.service.getSettings(user.org_id);
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateReEngagementSettingsDto,
  ) {
    return this.service.updateSettings(user.org_id, dto);
  }

  @Get('runs')
  listRuns(@CurrentUser() user: AuthUser) {
    return this.service.listRuns(user.org_id, 50);
  }

  @Get('eligible')
  listEligible(@CurrentUser() user: AuthUser) {
    return this.service.listEligible(user.org_id, 50);
  }

  /**
   * Trigger manual — útil pra debug ou pra rodar fora do ciclo de 1h.
   * Roda no orgId do user e retorna stats.
   */
  @Post('run-now')
  runNow(@CurrentUser() user: AuthUser) {
    return this.service.runForOrg(user.org_id);
  }
}
