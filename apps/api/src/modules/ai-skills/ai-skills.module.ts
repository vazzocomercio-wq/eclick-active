import { Global, Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AiSkillsController, PersonaSkillsController } from './ai-skills.controller';
import { AiSkillsService } from './ai-skills.service';

/**
 * Global pra AiService injetar AiSkillsService sem depender de import circular.
 */
@Global()
@Module({
  imports: [KnowledgeModule],
  controllers: [AiSkillsController, PersonaSkillsController],
  providers: [AiSkillsService],
  exports: [AiSkillsService],
})
export class AiSkillsModule {}
