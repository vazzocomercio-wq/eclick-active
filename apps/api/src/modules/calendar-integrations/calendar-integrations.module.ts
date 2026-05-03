import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { CalendarIntegrationsController } from './calendar-integrations.controller';
import { CalendarIntegrationsService } from './calendar-integrations.service';
import { GoogleCalendarService } from './google-calendar.service';
import { CalendlyService } from './calendly.service';

@Module({
  imports: [AuthModule],
  controllers: [CalendarIntegrationsController],
  providers: [CalendarIntegrationsService, GoogleCalendarService, CalendlyService],
  exports: [CalendarIntegrationsService, GoogleCalendarService, CalendlyService],
})
export class CalendarIntegrationsModule {}
