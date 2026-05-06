import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { WhatsAppCartService } from './cart.service';
import type { CartStatus, AddItemInput } from './cart.types';

@UseGuards(AuthGuard)
@Controller('whatsapp-commerce/carts')
export class CartController {
  constructor(private readonly carts: WhatsAppCartService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
  ) {
    return this.carts.list(user.org_id, {
      status: status as CartStatus | undefined,
    });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.carts.findById(user.org_id, id);
  }

  @Get('contact/:contactId')
  getActive(
    @CurrentUser() user: AuthUser,
    @Param('contactId') contactId: string,
  ) {
    return this.carts.getOrCreateCart(user.org_id, contactId);
  }

  @Post(':id/items')
  addItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: AddItemInput,
  ) {
    return this.carts.addItem(user.org_id, id, body);
  }

  @Delete(':id/items/:productId')
  removeItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.carts.removeItem(user.org_id, id, productId);
  }

  @Patch(':id/items/:productId')
  updateQty(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Body() body: { quantity: number },
  ) {
    return this.carts.updateQuantity(user.org_id, id, productId, body.quantity);
  }

  @Patch(':id/coupon')
  applyCoupon(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { code: string; discount: number },
  ) {
    return this.carts.applyCoupon(user.org_id, id, body.code, body.discount);
  }

  @Patch(':id/shipping')
  setShipping(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      method?: string;
      zip?: string;
      cost?: number;
      estimate_days?: number;
    },
  ) {
    return this.carts.setShipping(user.org_id, id, body);
  }

  @Post(':id/clear')
  clear(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.carts.clear(user.org_id, id);
  }
}
