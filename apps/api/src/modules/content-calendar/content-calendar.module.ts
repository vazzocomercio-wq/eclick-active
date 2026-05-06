import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { ContentCalendarController } from './content-calendar.controller';
import { ContentCalendarService } from './content-calendar.service';

/**
 * S5 — Calendário de Conteúdo (Onda 3 / único módulo da Onda 3 no Active).
 *
 * Depende de:
 *   - AuthModule (guards)
 *   - SupabaseModule (@Global)
 *   - LlmModule    (@Global, pra `generatePlan`)
 *
 * Não exporta nada — feature self-contained.
 */
@Module({
  imports: [AuthModule],
  controllers: [ContentCalendarController],
  providers: [ContentCalendarService],
})
export class ContentCalendarModule {}
