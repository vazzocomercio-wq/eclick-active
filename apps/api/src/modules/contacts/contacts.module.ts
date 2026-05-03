import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { WhatsappValidatorService } from './whatsapp-validator.service';
import { AuthModule } from '../../common/auth/auth.module';
import { AutomationsModule } from '../automations/automations.module';

@Module({
  imports: [AuthModule, AutomationsModule],
  controllers: [ContactsController],
  providers: [ContactsService, WhatsappValidatorService],
  exports: [ContactsService, WhatsappValidatorService],
})
export class ContactsModule {}
