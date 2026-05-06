import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { AuthModule } from '../../common/auth/auth.module';
import { EventsModule } from '../../gateways/events.module';
import { AutomationsModule } from '../automations/automations.module';
import { CatalogService } from './catalog/catalog.service';
import {
  CatalogController,
  CommerceSettingsController,
} from './catalog/catalog.controller';
import { CommerceSettingsService } from './settings/commerce-settings.service';
import { WhatsAppCartService } from './cart/cart.service';
import { CartController } from './cart/cart.controller';
import { CartSchedulerService } from './cart/cart-scheduler.service';
import { WhatsAppOrderService } from './order/order.service';
import { OrderController } from './order/order.controller';
import { MercadoPagoProvider } from './order/providers/mercado-pago.provider';
import { PixManualProvider } from './order/providers/pix-manual.provider';
import { PaymentWebhooksController } from './webhooks/payment-webhooks.controller';

@Module({
  imports: [SupabaseModule, AuthModule, EventsModule, AutomationsModule],
  controllers: [
    CatalogController,
    CommerceSettingsController,
    CartController,
    OrderController,
    PaymentWebhooksController,
  ],
  providers: [
    CatalogService,
    CommerceSettingsService,
    WhatsAppCartService,
    CartSchedulerService,
    WhatsAppOrderService,
    MercadoPagoProvider,
    PixManualProvider,
  ],
  exports: [
    CatalogService,
    CommerceSettingsService,
    WhatsAppCartService,
    WhatsAppOrderService,
  ],
})
export class WhatsAppCommerceModule {}
