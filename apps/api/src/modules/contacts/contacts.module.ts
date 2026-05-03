import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { WhatsappValidatorService } from './whatsapp-validator.service';
import { AuthModule } from '../../common/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ContactsController],
  providers: [ContactsService, WhatsappValidatorService],
  exports: [ContactsService, WhatsappValidatorService],
})
export class ContactsModule {}
