import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';

/**
 * Modulo global de LLM. Exporta LlmService pra ser injetado em qualquer
 * feature module sem precisar import explícito.
 *
 * Depende de SupabaseModule (também @Global) — não declarado aqui.
 */
@Global()
@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
