import { Global, Module } from '@nestjs/common';
import { ChannelDispatcherService } from './channel-dispatcher.service';
import { ZapiProvider } from './providers/zapi/zapi.provider';
import { BaileysProvider } from './providers/baileys/baileys.provider';
import { EmailProvider } from './providers/email/email.provider';
import { InstagramProvider } from './providers/instagram/instagram.provider';
import { TikTokProvider } from './providers/tiktok/tiktok.provider';

@Global()
@Module({
  providers: [
    ZapiProvider,
    BaileysProvider,
    EmailProvider,
    InstagramProvider,
    TikTokProvider,
    ChannelDispatcherService,
  ],
  exports: [
    ChannelDispatcherService,
    ZapiProvider,
    BaileysProvider,
    EmailProvider,
    InstagramProvider,
    TikTokProvider,
  ],
})
export class ChannelsModule {}
