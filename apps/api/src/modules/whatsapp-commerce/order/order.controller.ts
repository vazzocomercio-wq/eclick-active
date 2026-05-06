import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { WhatsAppOrderService } from './order.service';
import type {
  CreateOrderFromCartInput,
  OrderStatus,
  OrderPaymentStatus,
  WhatsAppOrder,
} from './order.types';

@UseGuards(AuthGuard)
@Controller('whatsapp-commerce/orders')
export class OrderController {
  constructor(private readonly orders: WhatsAppOrderService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('payment_status') paymentStatus?: string,
    @Query('contact_id') contactId?: string,
  ) {
    return this.orders.list(user.org_id, {
      status: status as OrderStatus | undefined,
      payment_status: paymentStatus as OrderPaymentStatus | undefined,
      contact_id: contactId,
    });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.findById(user.org_id, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateOrderFromCartInput,
  ) {
    return this.orders.createFromCart(user.org_id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<WhatsAppOrder>,
  ) {
    return this.orders.update(user.org_id, id, body);
  }

  @Post(':id/payment')
  regeneratePayment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.regeneratePaymentLink(user.org_id, id);
  }

  @Post(':id/mark-paid')
  markPaid(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { payment_id?: string },
  ) {
    return this.orders.markPaid(user.org_id, id, {
      payment_id: body?.payment_id,
    });
  }

  @Post(':id/ship')
  ship(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: { tracking_code: string; tracking_url?: string; carrier?: string },
  ) {
    return this.orders.ship(user.org_id, id, body);
  }

  @Post(':id/deliver')
  markDelivered(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.markDelivered(user.org_id, id);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.orders.cancel(user.org_id, id, body?.reason);
  }
}
