import { Module } from '@nestjs/common';
import { BoardController } from './board.controller';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [DealsController, BoardController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
