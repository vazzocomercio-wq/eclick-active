import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { AuthModule } from '../../common/auth/auth.module';
import { EventsModule } from '../../gateways/events.module';
import { AutomationsModule } from '../automations/automations.module';
import { AiModule } from '../ai/ai.module';
import { BridgeModule } from '../bridge/bridge.module';
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
import { SaleFlowService } from './sale-flow/sale-flow.service';

@Module({
  // AiModule (TransferService) e BridgeModule (BridgeService) entram por
  // causa do SaleFlowService (Fase C da vendedora IA). Sem ciclo: AiModule
  // não importa WhatsAppCommerceModule (o concierge resolve o SaleFlow via
  // ModuleRef lazy).
  imports: [
    SupabaseModule,
    AuthModule,
    EventsModule,
    AutomationsModule,
    AiModule,
    BridgeModule,
  ],
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
    SaleFlowService,
  ],
  exports: [
    CatalogService,
    CommerceSettingsService,
    WhatsAppCartService,
    WhatsAppOrderService,
    SaleFlowService,
  ],
})
export class WhatsAppCommerceModule {}
