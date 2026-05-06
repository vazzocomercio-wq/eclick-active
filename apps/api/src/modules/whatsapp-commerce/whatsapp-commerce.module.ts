import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { AuthModule } from '../../common/auth/auth.module';
import { EventsModule } from '../../gateways/events.module';
import { CatalogService } from './catalog/catalog.service';
import {
  CatalogController,
  CommerceSettingsController,
} from './catalog/catalog.controller';
import { CommerceSettingsService } from './settings/commerce-settings.service';
import { WhatsAppCartService } from './cart/cart.service';
import { CartController } from './cart/cart.controller';
import { CartSchedulerService } from './cart/cart-scheduler.service';

@Module({
  imports: [SupabaseModule, AuthModule, EventsModule],
  controllers: [CatalogController, CommerceSettingsController, CartController],
  providers: [
    CatalogService,
    CommerceSettingsService,
    WhatsAppCartService,
    CartSchedulerService,
  ],
  exports: [
    CatalogService,
    CommerceSettingsService,
    WhatsAppCartService,
  ],
})
export class WhatsAppCommerceModule {}
