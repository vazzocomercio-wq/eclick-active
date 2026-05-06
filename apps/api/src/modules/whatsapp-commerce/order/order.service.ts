import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { EventsGateway } from '../../../gateways/events.gateway';
import { WhatsAppCartService } from '../cart/cart.service';
import { CatalogService } from '../catalog/catalog.service';
import { MercadoPagoProvider } from './providers/mercado-pago.provider';
import { PixManualProvider } from './providers/pix-manual.provider';
import type {
  WhatsAppOrder,
  CreateOrderFromCartInput,
  OrderStatus,
  OrderPaymentStatus,
  PaymentLink,
} from './order.types';

interface ContactSnapshot {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
}

@Injectable()
export class WhatsAppOrderService {
  private readonly log = new Logger(WhatsAppOrderService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly events: EventsGateway,
    private readonly cart: WhatsAppCartService,
    private readonly catalog: CatalogService,
    private readonly mp: MercadoPagoProvider,
    private readonly pix: PixManualProvider,
  ) {}

  // ─── CRUD ───────────────────────────────────────

  async findById(orgId: string, id: string): Promise<WhatsAppOrder> {
    const { data } = await this.supabase.adminClient
      .from('whatsapp_orders')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Pedido não encontrado');
    return data as WhatsAppOrder;
  }

  async findByDisplayNumber(
    orgId: string,
    displayNumber: string,
  ): Promise<WhatsAppOrder | null> {
    const { data } = await this.supabase.adminClient
      .from('whatsapp_orders')
      .select('*')
      .eq('org_id', orgId)
      .eq('display_number', displayNumber)
      .maybeSingle();
    return (data as WhatsAppOrder | null) ?? null;
  }

  async findByExternalRef(externalRef: string): Promise<WhatsAppOrder | null> {
    const { data } = await this.supabase.adminClient
      .from('whatsapp_orders')
      .select('*')
      .eq('id', externalRef)
      .maybeSingle();
    return (data as WhatsAppOrder | null) ?? null;
  }

  async list(
    orgId: string,
    filters: {
      status?: OrderStatus;
      payment_status?: OrderPaymentStatus;
      contact_id?: string;
      limit?: number;
    } = {},
  ): Promise<WhatsAppOrder[]> {
    let q = this.supabase.adminClient
      .from('whatsapp_orders')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(filters.limit ?? 50);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.payment_status) q = q.eq('payment_status', filters.payment_status);
    if (filters.contact_id) q = q.eq('contact_id', filters.contact_id);
    const { data } = await q;
    return (data ?? []) as WhatsAppOrder[];
  }

  // ─── Criação a partir do carrinho ──────────────

  async createFromCart(
    orgId: string,
    input: CreateOrderFromCartInput,
  ): Promise<{ order: WhatsAppOrder; payment_link: PaymentLink | null }> {
    const cart = await this.cart.findById(orgId, input.cart_id);
    if (cart.items.length === 0) {
      throw new BadRequestException('Carrinho vazio');
    }
    if (cart.status !== 'active' && cart.status !== 'recovered') {
      throw new BadRequestException(`Carrinho está em ${cart.status}`);
    }

    // Snapshot do contato
    const contact = await this.fetchContact(orgId, cart.contact_id);
    if (!contact?.phone) {
      throw new BadRequestException('Contato sem telefone');
    }

    const { data: orderRow, error } = await this.supabase.adminClient
      .from('whatsapp_orders')
      .insert({
        org_id: orgId,
        contact_id: cart.contact_id,
        conversation_id: cart.conversation_id,
        cart_id: cart.id,
        items: cart.items,
        subtotal: cart.subtotal,
        discount_total: cart.discount_total,
        shipping_cost: cart.shipping_cost,
        total: cart.total,
        coupon_code: cart.coupon_code,
        customer_name: contact.full_name,
        customer_phone: contact.phone,
        customer_email: contact.email,
        shipping_address: input.shipping_address ?? {},
        payment_method: input.payment_method,
        payment_status: 'pending' as OrderPaymentStatus,
        status: 'pending' as OrderStatus,
        customer_notes: input.customer_notes ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;
    const order = orderRow as WhatsAppOrder;

    // Marca cart como convertido
    await this.cart.markConverted(cart.id, order.id);

    // Incrementa métricas de produtos
    for (const item of cart.items) {
      await this.catalog
        .incrementMetric(orgId, item.product_id, 'purchased')
        .catch(() => undefined);
    }

    // Gera link de pagamento (best-effort)
    let paymentLink: PaymentLink | null = null;
    try {
      paymentLink = await this.generatePaymentLink(order);
      if (paymentLink) {
        await this.supabase.adminClient
          .from('whatsapp_orders')
          .update({
            payment_link: paymentLink.url,
            payment_id: paymentLink.external_id ?? null,
            metadata: {
              ...order.metadata,
              payment_provider: paymentLink.provider,
              pix_copy_paste: paymentLink.pix_copy_paste,
            },
          })
          .eq('id', order.id);
        order.payment_link = paymentLink.url;
        order.payment_id = paymentLink.external_id ?? null;
      }
    } catch (err) {
      this.log.warn(
        `Falha ao gerar payment link pro pedido ${order.display_number}: ${String(err)}`,
      );
    }

    // Emit eventos
    try {
      this.events.emitToOrg(orgId, 'cart:converted', {
        cart_id: cart.id,
        contact_id: cart.contact_id,
      });
      this.events.emitToOrg(orgId, 'order:created', {
        order_id: order.id,
        display_number: order.display_number,
        contact_id: order.contact_id,
        total: order.total,
      });
    } catch {
      /* best-effort */
    }

    return { order, payment_link: paymentLink };
  }

  // ─── Payment ──────────────────────────────────

  async generatePaymentLink(order: WhatsAppOrder): Promise<PaymentLink | null> {
    const method = order.payment_method;
    if (!method || method === 'manual') return null;

    if (method === 'pix') {
      if (await this.pix.isAvailable(order.org_id)) {
        return this.pix.generateLink(order);
      }
    }
    if (await this.mp.isAvailable(order.org_id)) {
      return this.mp.generateLink(order);
    }
    this.log.warn(`Sem provider de pagamento ativo pra org ${order.org_id}`);
    return null;
  }

  async regeneratePaymentLink(
    orgId: string,
    orderId: string,
  ): Promise<PaymentLink | null> {
    const order = await this.findById(orgId, orderId);
    return this.generatePaymentLink(order);
  }

  async markPaid(
    orgId: string,
    orderId: string,
    args: { payment_id?: string; paid_at?: string } = {},
  ): Promise<WhatsAppOrder> {
    const { data, error } = await this.supabase.adminClient
      .from('whatsapp_orders')
      .update({
        payment_status: 'paid',
        status: 'confirmed',
        payment_id: args.payment_id ?? null,
        paid_at: args.paid_at ?? new Date().toISOString(),
      })
      .eq('id', orderId)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    const order = data as WhatsAppOrder;

    try {
      this.events.emitToOrg(orgId, 'order:paid', {
        order_id: order.id,
        display_number: order.display_number,
        contact_id: order.contact_id,
        total: order.total,
      });
    } catch {
      /* best-effort */
    }

    return order;
  }

  // ─── Shipping ────────────────────────────────

  async ship(
    orgId: string,
    orderId: string,
    args: {
      tracking_code: string;
      tracking_url?: string;
      carrier?: string;
    },
  ): Promise<WhatsAppOrder> {
    const { data, error } = await this.supabase.adminClient
      .from('whatsapp_orders')
      .update({
        shipping_status: 'shipped',
        status: 'shipped',
        tracking_code: args.tracking_code,
        tracking_url: args.tracking_url ?? null,
        shipped_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    const order = data as WhatsAppOrder;

    try {
      this.events.emitToOrg(orgId, 'order:shipped', {
        order_id: order.id,
        display_number: order.display_number,
        contact_id: order.contact_id,
      });
    } catch {
      /* best-effort */
    }

    return order;
  }

  async markDelivered(orgId: string, orderId: string): Promise<WhatsAppOrder> {
    const { data, error } = await this.supabase.adminClient
      .from('whatsapp_orders')
      .update({
        shipping_status: 'delivered',
        status: 'delivered',
        delivered_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as WhatsAppOrder;
  }

  async cancel(
    orgId: string,
    orderId: string,
    reason?: string,
  ): Promise<WhatsAppOrder> {
    const { data, error } = await this.supabase.adminClient
      .from('whatsapp_orders')
      .update({
        status: 'cancelled',
        payment_status: 'cancelled',
        internal_notes: reason ?? null,
      })
      .eq('id', orderId)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as WhatsAppOrder;
  }

  async update(
    orgId: string,
    orderId: string,
    patch: Partial<WhatsAppOrder>,
  ): Promise<WhatsAppOrder> {
    const { data, error } = await this.supabase.adminClient
      .from('whatsapp_orders')
      .update(patch)
      .eq('id', orderId)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as WhatsAppOrder;
  }

  // ─── helpers ────────────────────────────────

  private async fetchContact(
    orgId: string,
    contactId: string,
  ): Promise<ContactSnapshot | null> {
    const { data } = await this.supabase.adminClient
      .from('contacts')
      .select('id, full_name, phone, email')
      .eq('org_id', orgId)
      .eq('id', contactId)
      .maybeSingle();
    return (data as ContactSnapshot | null) ?? null;
  }
}
