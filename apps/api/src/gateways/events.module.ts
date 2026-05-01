import { Global, Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';

/**
 * @Global pra qualquer service injetar o gateway sem precisar de import
 * explícito (mesmo padrão de SupabaseModule e ChannelsModule).
 */
@Global()
@Module({
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
