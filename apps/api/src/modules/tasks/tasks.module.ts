import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { SaasCallbackClient } from './saas-callback.client';

@Module({
  imports: [AuthModule],
  controllers: [TasksController],
  providers: [TasksService, SaasCallbackClient],
  exports: [TasksService, SaasCallbackClient],
})
export class TasksModule {}
