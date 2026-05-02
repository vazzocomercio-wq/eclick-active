import { Global, Module } from '@nestjs/common';
import { ChannelDispatcherService } from './channel-dispatcher.service';
import { ZapiProvider } from './providers/zapi/zapi.provider';
import { BaileysProvider } from './providers/baileys/baileys.provider';
import { EmailProvider } from './providers/email/email.provider';

@Global()
@Module({
  providers: [ZapiProvider, BaileysProvider, EmailProvider, ChannelDispatcherService],
  exports: [ChannelDispatcherService, ZapiProvider, BaileysProvider, EmailProvider],
})
export class ChannelsModule {}
