import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { AttachmentsWorker } from './attachments.worker';

@Module({
  imports: [AuthModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, AttachmentsWorker],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
