import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  // ReportsService usa AnthropicClient (provider de AiModule).
  // AiModule já exporta AiService mas precisamos do cliente bruto;
  // pra evitar acoplar com AiService, copiamos a injeção do AnthropicClient
  // declarando provider compartilhado via AiModule (que exporta o module).
  imports: [AuthModule, AiModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
