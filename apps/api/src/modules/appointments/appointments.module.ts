import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { CalendarIntegrationsModule } from '../calendar-integrations/calendar-integrations.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AppointmentTypesService } from './appointment-types.service';
import { AvailabilityService } from './availability.service';
import { AppointmentReminderWorker } from './reminder.worker';

@Module({
  imports: [AuthModule, forwardRef(() => CalendarIntegrationsModule)],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    AppointmentTypesService,
    AvailabilityService,
    AppointmentReminderWorker,
  ],
  exports: [AppointmentsService, AppointmentTypesService],
})
export class AppointmentsModule {}
