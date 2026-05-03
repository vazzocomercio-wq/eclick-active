import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { ContactsModule } from '../contacts/contacts.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { FormsController } from './forms.controller';
import { FormsPublicController } from './forms-public.controller';
import { FormsService } from './forms.service';
import { FormProcessorService } from './form-processor.service';

@Module({
  imports: [AuthModule, ContactsModule, ConversationsModule],
  controllers: [FormsController, FormsPublicController],
  providers: [FormsService, FormProcessorService],
  exports: [FormsService],
})
export class FormsModule {}
