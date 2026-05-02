import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type {
  BusinessHoursConfig,
  BusinessHoursDayConfig,
  WeekdayKey,
} from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { BusinessHoursService } from './business-hours.service';
import { UpdateBusinessHoursDto } from './dto/business-hours.dto';

@UseGuards(AuthGuard)
@Controller('settings/business-hours')
export class BusinessHoursController {
  constructor(private readonly service: BusinessHoursService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<BusinessHoursConfig> {
    return this.service.get(user.org_id);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateBusinessHoursDto,
  ): Promise<BusinessHoursConfig> {
    // DTO usa shape parcial (Partial<Record<WeekdayKey, DayScheduleDto>>);
    // service merge interno trata campos faltantes. Cast pra satisfazer o
    // shape do service que espera Record<WeekdayKey, BusinessHoursDayConfig>.
    const merged: Partial<BusinessHoursConfig> = {
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
      ...(dto.schedule !== undefined
        ? { schedule: dto.schedule as Record<WeekdayKey, BusinessHoursDayConfig> }
        : {}),
    };
    return this.service.update(user.org_id, merged);
  }
}
