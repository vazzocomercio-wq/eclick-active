import { Global, Module } from '@nestjs/common';
import { ChannelDispatcherService } from './channel-dispatcher.service';
import { ZapiProvider } from './providers/zapi/zapi.provider';

@Global()
@Module({
  providers: [ZapiProvider, ChannelDispatcherService],
  exports: [ChannelDispatcherService, ZapiProvider],
})
export class ChannelsModule {}
