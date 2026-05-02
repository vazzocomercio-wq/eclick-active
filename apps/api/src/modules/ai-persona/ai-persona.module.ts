import { Global, Module } from '@nestjs/common';
import { AiPersonaController } from './ai-persona.controller';
import { AiPersonaService } from './ai-persona.service';

/**
 * Global pra que AiService e CopilotService possam injetar AiPersonaService
 * sem precisar listar AiPersonaModule no imports de cada um.
 */
@Global()
@Module({
  controllers: [AiPersonaController],
  providers: [AiPersonaService],
  exports: [AiPersonaService],
})
export class AiPersonaModule {}
