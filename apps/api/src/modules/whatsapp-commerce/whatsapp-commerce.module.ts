import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { AuthModule } from '../../common/auth/auth.module';
import { CatalogService } from './catalog/catalog.service';
import {
  CatalogController,
  CommerceSettingsController,
} from './catalog/catalog.controller';
import { CommerceSettingsService } from './settings/commerce-settings.service';

@Module({
  imports: [SupabaseModule, AuthModule],
  controllers: [CatalogController, CommerceSettingsController],
  providers: [CatalogService, CommerceSettingsService],
  exports: [CatalogService, CommerceSettingsService],
})
export class WhatsAppCommerceModule {}
