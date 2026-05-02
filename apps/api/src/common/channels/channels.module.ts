import { Global, Module } from '@nestjs/common';
import { ChannelDispatcherService } from './channel-dispatcher.service';
import { ZapiProvider } from './providers/zapi/zapi.provider';
import { BaileysProvider } from './providers/baileys/baileys.provider';

@Global()
@Module({
  providers: [ZapiProvider, BaileysProvider, ChannelDispatcherService],
  exports: [ChannelDispatcherService, ZapiProvider, BaileysProvider],
})
export class ChannelsModule {}
