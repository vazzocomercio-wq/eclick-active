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
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { ContentCalendarService } from './content-calendar.service';
import type {
  ContentCalendarEvent,
  CreateEventInput,
  GeneratePlanInput,
  GeneratePlanResult,
  ListEventsFilter,
  UpdateEventInput,
} from './content-calendar.types';

@UseGuards(AuthGuard)
@Controller('content-calendar')
export class ContentCalendarController {
  constructor(private readonly service: ContentCalendarService) {}

  // GET /content-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&channel=&status=
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() filter: ListEventsFilter,
  ): Promise<ContentCalendarEvent[]> {
    return this.service.list(user.org_id, filter);
  }

  // POST /content-calendar/generate-plan — DECLARADO ANTES de :id pra não colidir
  @Post('generate-plan')
  @HttpCode(HttpStatus.OK)
  generatePlan(
    @CurrentUser() user: AuthUser,
    @Body() body: GeneratePlanInput,
  ): Promise<GeneratePlanResult> {
    return this.service.generatePlan(user.org_id, user.id, body);
  }

  // GET /content-calendar/:id
  @Get(':id')
  findById(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ContentCalendarEvent> {
    return this.service.findById(user.org_id, id);
  }

  // POST /content-calendar
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateEventInput,
  ): Promise<ContentCalendarEvent> {
    return this.service.create(user.org_id, user.id, body);
  }

  // PATCH /content-calendar/:id — drag-and-drop manda só { scheduled_date, scheduled_time? }
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateEventInput,
  ): Promise<ContentCalendarEvent> {
    return this.service.update(user.org_id, id, body);
  }

  // DELETE /content-calendar/:id
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.service.remove(user.org_id, id);
  }
}
