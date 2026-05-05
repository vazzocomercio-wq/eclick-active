import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  AlertRoutingRule,
  AlertRoutingService,
} from './alert-routing.service';
import {
  CreateRoutingRuleDto,
  UpdateRoutingRuleDto,
} from './alerts.dto';

@UseGuards(AuthGuard)
@Controller('alert-routing-rules')
export class AlertRoutingController {
  constructor(private readonly service: AlertRoutingService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AlertRoutingRule[]> {
    return this.service.list(user.org_id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRoutingRuleDto,
  ): Promise<AlertRoutingRule> {
    return this.service.create(user.org_id, user.role, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRoutingRuleDto,
  ): Promise<AlertRoutingRule> {
    return this.service.update(user.org_id, user.role, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.service.remove(user.org_id, user.role, id);
  }
}
