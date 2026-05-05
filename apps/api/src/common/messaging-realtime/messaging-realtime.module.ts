import { Global, Module } from '@nestjs/common';
import { OutboundEventsService } from './outbound-events.service';

/**
 * Module global pro helper de emit de events de outbound automatizada.
 * Depende implicitamente de SupabaseModule (@Global) e EventsModule
 * (@Global) — não precisa importar.
 */
@Global()
@Module({
  providers: [OutboundEventsService],
  exports: [OutboundEventsService],
})
export class MessagingRealtimeModule {}
