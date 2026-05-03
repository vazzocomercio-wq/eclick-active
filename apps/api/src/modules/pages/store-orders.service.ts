import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  OrderItem,
  Page,
  PaymentStatus,
  StoreOrder,
  StoreProduct,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ContactsService } from '../contacts/contacts.service';
import { EventsGateway } from '../../gateways/events.gateway';
import { ChannelDispatcherService } from '../../common/channels/channel-dispatcher.service';
import { CreateOrderDto, UpdateOrderDto } from './dto/page.dto';

interface CreateOrderInput {
  pageId: string;
  orgId: string;
  page: Page;
  dto: CreateOrderDto;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class StoreOrdersService {
  private readonly logger = new Logger(StoreOrdersService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly contacts: ContactsService,
    private readonly events: EventsGateway,
    private readonly dispatcher: ChannelDispatcherService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // CREATE — pipeline completo: validar → contato → deal → notify
  // ──────────────────────────────────────────────────────────

  async create(input: CreateOrderInput): Promise<StoreOrder> {
    const { dto, page, orgId, pageId } = input;

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Pedido sem itens');
    }

    // 1. Carrega produtos do pedido pra calcular totais com preços oficiais
    const productIds = dto.items.map((i) => i.product_id);
    const { data: prodData, error: prodErr } = await this.supabase.adminClient
      .from('store_products')
      .select('*')
      .eq('page_id', pageId)
      .in('id', productIds);
    if (prodErr) throw new InternalServerErrorException(prodErr.message);
    const products = (prodData ?? []) as StoreProduct[];

    if (products.length !== productIds.length) {
      throw new BadRequestException('Algum produto não existe');
    }

    // 2. Valida estoque + monta itens com preço oficial
    const items: OrderItem[] = [];
    let subtotal = 0;
    for (const li of dto.items) {
      const p = products.find((x) => x.id === li.product_id);
      if (!p || !p.is_active) {
        throw new BadRequestException(`Produto ${li.product_id} indisponível`);
      }
      if (p.stock_quantity !== null && p.stock_quantity < li.quantity) {
        throw new BadRequestException(`Estoque insuficiente: ${p.name}`);
      }
      const lineSubtotal = p.price * li.quantity;
      subtotal += lineSubtotal;
      items.push({
        product_id: p.id,
        name: p.name,
        price: p.price,
        quantity: li.quantity,
        variant_label: li.variant_label,
        image: p.images[0],
        subtotal: lineSubtotal,
      });
    }

    // 3. Calcula frete + total
    const storeCfg = page.settings.store ?? {};
    const fee = storeCfg.shipping_fee ?? 0;
    const freeAbove = storeCfg.free_shipping_above;
    const shipping =
      freeAbove !== undefined && subtotal >= freeAbove ? 0 : fee;
    const total = subtotal + shipping;

    // 4. Cria/atualiza contato no CRM
    let contactId: string | null = null;
    try {
      const contact = await this.contacts.findOrCreateByPhone(
        orgId,
        dto.customer_phone,
        dto.customer_name,
      );
      contactId = contact.id;
    } catch (err) {
      this.logger.warn(
        `findOrCreate contact falhou: ${err instanceof Error ? err.message : err}`,
      );
    }

    // 5. Cria deal vinculado (no pipeline default ou na configuração da org)
    let dealId: string | null = null;
    try {
      const dealRow = await this.createDealForOrder(orgId, contactId, items, total);
      dealId = dealRow;
    } catch (err) {
      this.logger.warn(
        `create deal falhou: ${err instanceof Error ? err.message : err}`,
      );
    }

    // 6. Insere pedido
    const { data, error } = await this.supabase.adminClient
      .from('store_orders')
      .insert({
        org_id: orgId,
        page_id: pageId,
        contact_id: contactId,
        deal_id: dealId,
        items,
        subtotal,
        shipping,
        discount: 0,
        total,
        customer_name: dto.customer_name,
        customer_email: dto.customer_email ?? null,
        customer_phone: dto.customer_phone,
        customer_address: dto.customer_address ?? null,
        payment_method: dto.payment_method ?? null,
        payment_status: 'pending',
        fulfillment_status: 'unfulfilled',
        notes: dto.notes ?? null,
        utm_source: dto.utm_source ?? null,
        utm_campaign: dto.utm_campaign ?? null,
      })
      .select('*')
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    const order = data as StoreOrder;

    // 7. Decrementa estoque dos produtos com stock_quantity
    for (const it of items) {
      const p = products.find((x) => x.id === it.product_id);
      if (p && p.stock_quantity !== null) {
        await this.supabase.adminClient
          .from('store_products')
          .update({ stock_quantity: Math.max(0, p.stock_quantity - it.quantity) })
          .eq('id', p.id);
      }
    }

    // 8. Envia notificação WhatsApp pro admin (se configurado)
    void this.notifyAdmin(orgId, page, order).catch((err) => {
      this.logger.warn(
        `notifyAdmin falhou: ${err instanceof Error ? err.message : err}`,
      );
    });

    // 9. (Notificação in-app fica via Supabase realtime no `notifications`
    // table — orders.create insere lá e o frontend assina. Por ora a
    // notificação principal é via WhatsApp ao admin.)
    void this.events; // mantém referência pra futuro broadcast

    return order;
  }

  // ──────────────────────────────────────────────────────────
  // List + filters
  // ──────────────────────────────────────────────────────────

  async list(
    orgId: string,
    pageId: string | null,
    filters: {
      payment_status?: string;
      fulfillment_status?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{ data: StoreOrder[]; total: number }> {
    let q = this.supabase.adminClient
      .from('store_orders')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId);
    if (pageId) q = q.eq('page_id', pageId);
    if (filters.payment_status) q = q.eq('payment_status', filters.payment_status);
    if (filters.fulfillment_status) q = q.eq('fulfillment_status', filters.fulfillment_status);
    if (filters.from) q = q.gte('created_at', filters.from);
    if (filters.to) q = q.lte('created_at', filters.to);

    const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
    const page = Math.max(1, filters.page ?? 1);
    const offset = (page - 1) * limit;
    q = q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, count, error } = await q;
    if (error) throw new InternalServerErrorException(error.message);
    return { data: (data ?? []) as StoreOrder[], total: count ?? 0 };
  }

  async findById(orgId: string, orderId: string): Promise<StoreOrder> {
    const { data, error } = await this.supabase.adminClient
      .from('store_orders')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', orderId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Order ${orderId}`);
    return data as StoreOrder;
  }

  async update(orgId: string, orderId: string, dto: UpdateOrderDto): Promise<StoreOrder> {
    const patch: Record<string, unknown> = {};
    if (dto.payment_status) patch.payment_status = dto.payment_status;
    if (dto.fulfillment_status) patch.fulfillment_status = dto.fulfillment_status;
    if (dto.notes !== undefined) patch.notes = dto.notes;

    const { data, error } = await this.supabase.adminClient
      .from('store_orders')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', orderId)
      .select('*')
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Order ${orderId}`);
    return data as StoreOrder;
  }

  async getAnalytics(
    orgId: string,
    pageId?: string,
    days = 30,
  ): Promise<{
    total_revenue: number;
    total_orders: number;
    avg_order_value: number;
    paid_orders: number;
    pending_orders: number;
    by_day: { date: string; revenue: number; orders: number }[];
    top_products: { product_id: string; name: string; quantity: number; revenue: number }[];
    by_payment_status: { status: PaymentStatus; count: number }[];
  }> {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    let q = this.supabase.adminClient
      .from('store_orders')
      .select('items, subtotal, total, payment_status, created_at')
      .eq('org_id', orgId)
      .gte('created_at', since);
    if (pageId) q = q.eq('page_id', pageId);
    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(error.message);
    const orders =
      (data ?? []) as Array<{
        items: OrderItem[];
        subtotal: number;
        total: number;
        payment_status: PaymentStatus;
        created_at: string;
      }>;

    const total_orders = orders.length;
    const paid = orders.filter((o) => o.payment_status === 'paid');
    const total_revenue = paid.reduce((s, o) => s + o.total, 0);
    const avg_order_value = total_orders > 0 ? total_revenue / Math.max(1, paid.length) : 0;

    // by_day
    const byDayMap = new Map<string, { revenue: number; orders: number }>();
    for (const o of orders) {
      const date = o.created_at.slice(0, 10);
      const cell = byDayMap.get(date) ?? { revenue: 0, orders: 0 };
      cell.orders += 1;
      if (o.payment_status === 'paid') cell.revenue += o.total;
      byDayMap.set(date, cell);
    }
    const by_day = Array.from(byDayMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // top_products
    const prodMap = new Map<string, { name: string; quantity: number; revenue: number }>();
    for (const o of orders) {
      for (const it of o.items) {
        const cell = prodMap.get(it.product_id) ?? {
          name: it.name,
          quantity: 0,
          revenue: 0,
        };
        cell.quantity += it.quantity;
        cell.revenue += it.subtotal;
        prodMap.set(it.product_id, cell);
      }
    }
    const top_products = Array.from(prodMap.entries())
      .map(([id, v]) => ({ product_id: id, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // by_payment_status
    const statusMap = new Map<PaymentStatus, number>();
    for (const o of orders) {
      statusMap.set(o.payment_status, (statusMap.get(o.payment_status) ?? 0) + 1);
    }
    const by_payment_status = Array.from(statusMap.entries()).map(([status, count]) => ({
      status,
      count,
    }));

    return {
      total_revenue: Math.round(total_revenue * 100) / 100,
      total_orders,
      avg_order_value: Math.round(avg_order_value * 100) / 100,
      paid_orders: paid.length,
      pending_orders: orders.filter((o) => o.payment_status === 'pending').length,
      by_day,
      top_products,
      by_payment_status,
    };
  }

  // ──────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────

  private async createDealForOrder(
    orgId: string,
    contactId: string | null,
    items: OrderItem[],
    total: number,
  ): Promise<string | null> {
    if (!contactId) return null;
    // Pega o pipeline default da org + primeiro stage
    const { data: pipelines } = await this.supabase.adminClient
      .from('pipelines')
      .select('id, stages:pipeline_stages(id, position)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })
      .limit(1);
    const pipeline = (pipelines ?? [])[0] as
      | { id: string; stages: { id: string; position: number }[] }
      | undefined;
    if (!pipeline) return null;
    const firstStage = pipeline.stages.sort((a, b) => a.position - b.position)[0];
    if (!firstStage) return null;

    const itemsLabel = items
      .map((i) => `${i.quantity}x ${i.name}`)
      .slice(0, 3)
      .join(', ');
    const title = `Pedido — ${itemsLabel}${items.length > 3 ? '...' : ''}`;

    const { data, error } = await this.supabase.adminClient
      .from('deals')
      .insert({
        org_id: orgId,
        contact_id: contactId,
        pipeline_id: pipeline.id,
        stage_id: firstStage.id,
        title: title.slice(0, 200),
        value: total,
        currency: 'BRL',
      })
      .select('id')
      .maybeSingle();
    if (error) {
      this.logger.warn(`createDealForOrder erro: ${error.message}`);
      return null;
    }
    return (data as { id: string } | null)?.id ?? null;
  }

  private async notifyAdmin(orgId: string, page: Page, order: StoreOrder): Promise<void> {
    const adminPhone = page.settings.store?.admin_phone?.replace(/\D/g, '');
    if (!adminPhone) return;

    // Acha um canal whatsapp ativo da org
    const { data: channels } = await this.supabase.adminClient
      .from('channels')
      .select('id, channel_type')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .in('channel_type', ['whatsapp', 'whatsapp_free'])
      .limit(1);
    const channel = (channels ?? [])[0] as { id: string } | undefined;
    if (!channel) return;

    // Acha/cria contato pra esse phone (admin)
    const adminContact = await this.contacts.findOrCreateByPhone(
      orgId,
      adminPhone,
      'Admin',
    );

    const itemsList = order.items
      .map((i) => `• ${i.quantity}x ${i.name} — R$ ${i.subtotal.toFixed(2)}`)
      .join('\n');
    const message = `🛒 Novo pedido #${order.order_number}

${itemsList}

Subtotal: R$ ${order.subtotal.toFixed(2)}
Frete: R$ ${order.shipping.toFixed(2)}
*Total: R$ ${order.total.toFixed(2)}*

Cliente: ${order.customer_name}
Tel: ${order.customer_phone}${order.customer_email ? `\nEmail: ${order.customer_email}` : ''}${order.notes ? `\n\nObs: ${order.notes}` : ''}

Acessar pedido: ${process.env.WEB_BASE_URL ?? ''}/paginas/${page.id}/pedidos/${order.id}`;

    try {
      await this.dispatcher.send({
        org_id: orgId,
        channel_id: channel.id,
        contact_id: adminContact.id,
        content_type: 'text',
        content: { body: message },
      });
    } catch (err) {
      this.logger.warn(
        `notifyAdmin send falhou: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
