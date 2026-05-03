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
import type {
  AgentAvailability,
  AppointmentDetail,
  AppointmentType,
  AvailabilitySlot,
} from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { AppointmentsService } from './appointments.service';
import { AppointmentTypesService } from './appointment-types.service';
import { AvailabilityService } from './availability.service';
import {
  CalendarRangeQueryDto,
  CancelAppointmentDto,
  CreateAppointmentDto,
  GetSlotsQueryDto,
  ListAppointmentsQueryDto,
  RescheduleAppointmentDto,
  UpdateAppointmentDto,
} from './dto/appointment.dto';
import {
  CreateAppointmentTypeDto,
  UpdateAppointmentTypeDto,
} from './dto/appointment-type.dto';
import { SetAvailabilityDto, SetDateOverrideDto } from './dto/availability.dto';

@UseGuards(AuthGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly types: AppointmentTypesService,
    private readonly availability: AvailabilityService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // Appointment types — declarado ANTES de :id
  // ──────────────────────────────────────────────────────────

  @Get('types')
  listTypes(@CurrentUser() user: AuthUser): Promise<AppointmentType[]> {
    return this.types.list(user.org_id, true);
  }

  @Post('types')
  @HttpCode(HttpStatus.CREATED)
  createType(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAppointmentTypeDto,
  ): Promise<AppointmentType> {
    return this.types.create(user.org_id, dto);
  }

  @Patch('types/:id')
  updateType(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentTypeDto,
  ): Promise<AppointmentType> {
    return this.types.update(user.org_id, id, dto);
  }

  @Delete('types/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteType(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.types.delete(user.org_id, id);
  }

  // ──────────────────────────────────────────────────────────
  // Slots / calendar / today — antes de :id
  // ──────────────────────────────────────────────────────────

  @Get('slots')
  getSlots(
    @CurrentUser() user: AuthUser,
    @Query() query: GetSlotsQueryDto,
  ): Promise<AvailabilitySlot[]> {
    return this.appointments.getAvailableSlots(user.org_id, query);
  }

  @Get('calendar')
  getCalendar(
    @CurrentUser() user: AuthUser,
    @Query() query: CalendarRangeQueryDto,
  ): Promise<AppointmentDetail[]> {
    return this.appointments.getCalendarRange(user.org_id, query);
  }

  @Get('my/today')
  getMyToday(@CurrentUser() user: AuthUser): Promise<AppointmentDetail[]> {
    return this.appointments.getMyToday(user.org_id, user.id);
  }

  // ──────────────────────────────────────────────────────────
  // Availability — antes de :id
  // ──────────────────────────────────────────────────────────

  @Get('availability/:agentId')
  getAvailability(
    @CurrentUser() user: AuthUser,
    @Param('agentId', ParseUUIDPipe) agentId: string,
  ): Promise<AgentAvailability[]> {
    return this.availability.getAvailability(user.org_id, agentId);
  }

  @Post('availability')
  @HttpCode(HttpStatus.OK)
  setAvailability(
    @CurrentUser() user: AuthUser,
    @Body() dto: SetAvailabilityDto,
  ): Promise<AgentAvailability[]> {
    return this.availability.setAvailability(user.org_id, dto);
  }

  @Post('availability/override')
  @HttpCode(HttpStatus.OK)
  setOverride(
    @CurrentUser() user: AuthUser,
    @Body() dto: SetDateOverrideDto,
  ): Promise<AgentAvailability> {
    return this.availability.setDateOverride(user.org_id, dto);
  }

  // ──────────────────────────────────────────────────────────
  // Appointments CRUD
  // ──────────────────────────────────────────────────────────

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAppointmentsQueryDto,
  ): Promise<AppointmentDetail[]> {
    return this.appointments.findAll(user.org_id, query, user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAppointmentDto,
  ): Promise<AppointmentDetail> {
    return this.appointments.create(user.org_id, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AppointmentDetail> {
    return this.appointments.findById(user.org_id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
  ): Promise<AppointmentDetail> {
    return this.appointments.update(user.org_id, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
  ): Promise<AppointmentDetail> {
    return this.appointments.cancel(user.org_id, id, dto.reason);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AppointmentDetail> {
    return this.appointments.complete(user.org_id, id);
  }

  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  noShow(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AppointmentDetail> {
    return this.appointments.markNoShow(user.org_id, id);
  }

  @Post(':id/reschedule')
  @HttpCode(HttpStatus.OK)
  reschedule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleAppointmentDto,
  ): Promise<AppointmentDetail> {
    return this.appointments.reschedule(user.org_id, id, dto);
  }
}
