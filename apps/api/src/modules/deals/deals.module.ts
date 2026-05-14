import { Module } from '@nestjs/common';
import { BoardController } from './board.controller';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { AiModule } from '../ai/ai.module';
import { AutomationsModule } from '../automations/automations.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [AiModule, AutomationsModule, TasksModule],
  controllers: [DealsController, BoardController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
