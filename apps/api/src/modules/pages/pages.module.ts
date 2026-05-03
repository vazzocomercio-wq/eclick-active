import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { ContactsModule } from '../contacts/contacts.module';
import { PagesController } from './pages.controller';
import { PagesPublicController } from './pages-public.controller';
import { PagesService } from './pages.service';
import { PageRendererService } from './page-renderer.service';
import { AiPageGeneratorService } from './ai-page-generator.service';
import { StoreProductsService } from './store-products.service';
import { StoreOrdersService } from './store-orders.service';

@Module({
  imports: [AuthModule, ContactsModule],
  controllers: [PagesController, PagesPublicController],
  providers: [
    PagesService,
    PageRendererService,
    AiPageGeneratorService,
    StoreProductsService,
    StoreOrdersService,
  ],
  exports: [PagesService, StoreProductsService, StoreOrdersService],
})
export class PagesModule {}
