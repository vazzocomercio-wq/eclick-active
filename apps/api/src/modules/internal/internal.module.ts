import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';

/**
 * Endpoints internos consumidos por outros serviços nossos (worker, jobs).
 * Não vão atrás do AuthGuard — protegidos por header `X-Internal-Key`.
 *
 * EventsGateway já é exposto pelo EventsModule (@Global), então não
 * precisa importar.
 */
@Module({
  controllers: [InternalController],
})
export class InternalModule {}
