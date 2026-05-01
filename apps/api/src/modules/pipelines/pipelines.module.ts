import { Module } from '@nestjs/common';
import { PipelinesController } from './pipelines.controller';
import { PipelinesService } from './pipelines.service';
import { StagesService } from './stages.service';

@Module({
  controllers: [PipelinesController],
  providers: [PipelinesService, StagesService],
  exports: [PipelinesService, StagesService],
})
export class PipelinesModule {}
