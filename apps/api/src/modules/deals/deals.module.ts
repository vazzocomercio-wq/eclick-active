import { Module } from '@nestjs/common';
import { BoardController } from './board.controller';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';

@Module({
  controllers: [DealsController, BoardController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
