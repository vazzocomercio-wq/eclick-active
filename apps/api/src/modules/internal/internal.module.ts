import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AutomationsModule } from '../automations/automations.module';
import { InternalController } from './internal.controller';

/**
 * Endpoints internos consumidos por outros serviços nossos (worker, jobs).
 * Não vão atrás do AuthGuard — protegidos por header `X-Internal-Key`.
 *
 * EventsGateway já é exposto pelo EventsModule (@Global), então não
 * precisa importar. AiService e AutomationsService precisam importar
 * os módulos pra injeção funcionar.
 */
@Module({
  imports: [AiModule, AutomationsModule],
  controllers: [InternalController],
})
export class InternalModule {}
