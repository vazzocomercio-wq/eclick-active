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
import { SaleFlowService } from '../sale-flow/sale-flow.service';
import type {
  CreateOrderFromCartInput,
  OrderStatus,
  OrderPaymentStatus,
  WhatsAppOrder,
} from './order.types';

@UseGuards(AuthGuard)
@Controller('whatsapp-commerce/orders')
export class OrderController {
  constructor(
    private readonly orders: WhatsAppOrderService,
    private readonly saleFlow: SaleFlowService,
  ) {}

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
  async markPaid(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { payment_id?: string },
  ) {
    const order = await this.orders.markPaid(user.org_id, id, {
      payment_id: body?.payment_id,
    });
    // Fase C (vendedora IA): Pix manual não tem webhook — quando o agente
    // confere o extrato e marca pago aqui, o sale flow confirma na conversa.
    void this.saleFlow.onOrderPaid(order).catch(() => undefined);
    return order;
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

  // ─── Timeline (B6) ───────────────────────────

  @Get(':id/events')
  listEvents(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.orders.listEvents(
      user.org_id,
      id,
      limit ? Math.min(parseInt(limit, 10) || 100, 500) : 100,
    );
  }

  @Post(':id/events')
  addEvent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      event_type: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.orders.addEvent(user.org_id, id, {
      event_type: body.event_type,
      description: body.description,
      actor_type: 'agent',
      actor_id: user.id,
      metadata: body.metadata ?? {},
    });
  }
}
