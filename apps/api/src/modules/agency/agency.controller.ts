import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { AgencyService } from './agency.service';

@UseGuards(AuthGuard)
@Controller('agency')
export class AgencyController {
  constructor(private readonly agency: AgencyService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.agency.listOrgsForUser(user.id);
  }
}
