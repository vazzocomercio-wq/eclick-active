import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { AutomationsService } from '../../automations/automations.service';
import type {
  WhatsAppCart,
  CartItem,
  AddItemInput,
  CartStatus,
} from './cart.types';

/**
 * Service do carrinho WhatsApp.
 *
 * Comportamento:
 *   - 1 carrinho ativo por (contact_id, org_id) — se já existe um, reusa
 *   - Carrinho abandoned é "ressuscitado" pra recovered quando contato volta
 *   - Items array em JSONB com subtotal calculado por item
 *   - Recálculo automático de totais a cada mudança
 *   - last_interaction_at atualizado em qualquer write
 */
@Injectable()
export class WhatsAppCartService {
  private readonly log = new Logger(WhatsAppCartService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly automations: AutomationsService,
  ) {}

  /**
   * Pega carrinho ativo do contato. Se houver abandoned, ressuscita
   * pra recovered + cria novo active vinculado à conversa.
   */
  async getOrCreateCart(
    orgId: string,
    contactId: string,
    conversationId?: string | null,
  ): Promise<WhatsAppCart> {
    // Tenta achar carrinho ativo
    const { data: active } = await this.supabase.adminClient
      .from('whatsapp_carts')
      .select('*')
      .eq('org_id', orgId)
      .eq('contact_id', contactId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (active) {
      // Atualiza conversation_id se vier diferente
      if (conversationId && (active as WhatsAppCart).conversation_id !== conversationId) {
        await this.supabase.adminClient
          .from('whatsapp_carts')
          .update({ conversation_id: conversationId })
          .eq('id', (active as WhatsAppCart).id);
      }
      return active as WhatsAppCart;
    }

    // Tenta ressuscitar abandoned
    const { data: abandoned } = await this.supabase.adminClient
      .from('whatsapp_carts')
      .select('*')
      .eq('org_id', orgId)
      .eq('contact_id', contactId)
      .eq('status', 'abandoned')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (abandoned) {
      const old = abandoned as WhatsAppCart;
      // Marca antigo como recovered
      await this.supabase.adminClient
        .from('whatsapp_carts')
        .update({
          status: 'recovered',
          recovered_at: new Date().toISOString(),
        })
        .eq('id', old.id);
      // Cria novo active com mesmos items
      const created = await this.create(orgId, contactId, conversationId ?? null, {
        items: old.items,
        subtotal: old.subtotal,
        total: old.total,
        coupon_code: old.coupon_code,
        coupon_discount: old.coupon_discount,
        shipping_cost: old.shipping_cost,
      });
      // Dispara automation cart_recovered (fire-and-forget)
      void this.automations
        .checkTriggers({
          event: 'cart_recovered',
          org_id: orgId,
          cart_id: created.id,
          contact_id: contactId,
          conversation_id: conversationId ?? null,
          total: Number(created.total ?? 0),
        })
        .catch((err) =>
          this.log.warn(
            `automations cart_recovered falhou: ${String(err)}`,
          ),
        );
      return created;
    }

    // Cria novo
    return this.create(orgId, contactId, conversationId ?? null);
  }

  private async create(
    orgId: string,
    contactId: string,
    conversationId: string | null,
    initial: Partial<WhatsAppCart> = {},
  ): Promise<WhatsAppCart> {
    const { data, error } = await this.supabase.adminClient
      .from('whatsapp_carts')
      .insert({
        org_id: orgId,
        contact_id: contactId,
        conversation_id: conversationId,
        items: initial.items ?? [],
        subtotal: initial.subtotal ?? 0,
        discount_total: 0,
        shipping_cost: initial.shipping_cost ?? 0,
        total: initial.total ?? 0,
        coupon_code: initial.coupon_code ?? null,
        coupon_discount: initial.coupon_discount ?? 0,
        status: 'active' as CartStatus,
        last_interaction_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as WhatsAppCart;
  }

  async findById(orgId: string, id: string): Promise<WhatsAppCart> {
    const { data } = await this.supabase.adminClient
      .from('whatsapp_carts')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Carrinho não encontrado');
    return data as WhatsAppCart;
  }

  async list(
    orgId: string,
    filters: { status?: CartStatus; contact_id?: string; limit?: number } = {},
  ): Promise<WhatsAppCart[]> {
    let q = this.supabase.adminClient
      .from('whatsapp_carts')
      .select('*')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(filters.limit ?? 50);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.contact_id) q = q.eq('contact_id', filters.contact_id);
    const { data } = await q;
    return (data ?? []) as WhatsAppCart[];
  }

  // ─── Ops de items ────────────────────────────────

  async addItem(
    orgId: string,
    cartId: string,
    item: AddItemInput,
  ): Promise<WhatsAppCart> {
    const cart = await this.findById(orgId, cartId);
    const items = [...cart.items];
    const existingIdx = items.findIndex((i) => i.product_id === item.product_id);

    if (existingIdx >= 0) {
      const existing = items[existingIdx]!;
      existing.quantity += item.quantity;
      existing.subtotal = +(existing.quantity * existing.unit_price).toFixed(2);
      items[existingIdx] = existing;
    } else {
      const subtotal = +(item.quantity * item.unit_price).toFixed(2);
      items.push({
        product_id: item.product_id,
        name: item.name,
        sku: item.sku ?? null,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_pct: 0,
        subtotal,
        thumbnail_url: item.thumbnail_url ?? null,
        added_at: new Date().toISOString(),
      });
    }

    return this.persistItems(orgId, cartId, items, cart);
  }

  async removeItem(
    orgId: string,
    cartId: string,
    productId: string,
  ): Promise<WhatsAppCart> {
    const cart = await this.findById(orgId, cartId);
    const items = cart.items.filter((i) => i.product_id !== productId);
    return this.persistItems(orgId, cartId, items, cart);
  }

  async updateQuantity(
    orgId: string,
    cartId: string,
    productId: string,
    quantity: number,
  ): Promise<WhatsAppCart> {
    if (quantity < 0) throw new BadRequestException('Quantidade negativa');
    if (quantity === 0) return this.removeItem(orgId, cartId, productId);
    const cart = await this.findById(orgId, cartId);
    const items = cart.items.map((i) =>
      i.product_id === productId
        ? {
            ...i,
            quantity,
            subtotal: +(quantity * i.unit_price).toFixed(2),
          }
        : i,
    );
    return this.persistItems(orgId, cartId, items, cart);
  }

  async clear(orgId: string, cartId: string): Promise<WhatsAppCart> {
    const cart = await this.findById(orgId, cartId);
    return this.persistItems(orgId, cartId, [], cart);
  }

  // ─── Cupom + frete ──────────────────────────────

  async applyCoupon(
    orgId: string,
    cartId: string,
    couponCode: string,
    discountAmount: number,
  ): Promise<WhatsAppCart> {
    const cart = await this.findById(orgId, cartId);
    const totals = this.calculateTotals(
      cart.items,
      discountAmount,
      cart.shipping_cost,
    );
    const { data, error } = await this.supabase.adminClient
      .from('whatsapp_carts')
      .update({
        coupon_code: couponCode,
        coupon_discount: discountAmount,
        ...totals,
        last_interaction_at: new Date().toISOString(),
      })
      .eq('id', cartId)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as WhatsAppCart;
  }

  async setShipping(
    orgId: string,
    cartId: string,
    args: {
      method?: string;
      zip?: string;
      cost?: number;
      estimate_days?: number;
    },
  ): Promise<WhatsAppCart> {
    const cart = await this.findById(orgId, cartId);
    const totals = this.calculateTotals(
      cart.items,
      cart.coupon_discount,
      args.cost ?? cart.shipping_cost,
    );
    const { data, error } = await this.supabase.adminClient
      .from('whatsapp_carts')
      .update({
        shipping_method: args.method ?? cart.shipping_method,
        shipping_zip: args.zip ?? cart.shipping_zip,
        shipping_cost: args.cost ?? cart.shipping_cost,
        shipping_estimate_days: args.estimate_days ?? cart.shipping_estimate_days,
        ...totals,
        last_interaction_at: new Date().toISOString(),
      })
      .eq('id', cartId)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as WhatsAppCart;
  }

  // ─── Status transitions ─────────────────────────

  async markAbandoned(cartId: string): Promise<void> {
    await this.supabase.adminClient
      .from('whatsapp_carts')
      .update({
        status: 'abandoned',
        abandoned_at: new Date().toISOString(),
      })
      .eq('id', cartId);
  }

  async markConverted(cartId: string, orderId: string): Promise<void> {
    await this.supabase.adminClient
      .from('whatsapp_carts')
      .update({
        status: 'converted',
        converted_at: new Date().toISOString(),
        order_id: orderId,
      })
      .eq('id', cartId);
  }

  // ─── helpers ────────────────────────────────────

  private async persistItems(
    orgId: string,
    cartId: string,
    items: CartItem[],
    cart: WhatsAppCart,
  ): Promise<WhatsAppCart> {
    const totals = this.calculateTotals(
      items,
      cart.coupon_discount,
      cart.shipping_cost,
    );
    const { data, error } = await this.supabase.adminClient
      .from('whatsapp_carts')
      .update({
        items,
        ...totals,
        last_interaction_at: new Date().toISOString(),
        interaction_count: cart.interaction_count + 1,
        ai_assisted: true,
      })
      .eq('id', cartId)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as WhatsAppCart;
  }

  private calculateTotals(
    items: CartItem[],
    couponDiscount: number,
    shippingCost: number,
  ): { subtotal: number; discount_total: number; total: number } {
    const subtotal = +items.reduce((s, i) => s + i.subtotal, 0).toFixed(2);
    const discount_total = +(couponDiscount ?? 0).toFixed(2);
    const total = +(subtotal - discount_total + (shippingCost ?? 0)).toFixed(2);
    return { subtotal, discount_total, total };
  }

  // ─── Format pra mensagem WhatsApp ───────────────

  formatForWhatsApp(cart: WhatsAppCart): string {
    if (cart.items.length === 0) return '🛒 Seu carrinho está vazio.';
    const lines: string[] = ['🛒 *Seu carrinho:*', ''];
    cart.items.forEach((item, i) => {
      lines.push(
        `${i + 1}. *${item.name}*`,
        `   ${item.quantity}x R$ ${item.unit_price.toFixed(2)} = R$ ${item.subtotal.toFixed(2)}`,
        '',
      );
    });
    lines.push('━━━━━━━━━━━━━━');
    if (cart.discount_total > 0) {
      lines.push(`🎁 Desconto: -R$ ${cart.discount_total.toFixed(2)}`);
    }
    if (cart.shipping_cost > 0) {
      lines.push(`📦 Frete: R$ ${cart.shipping_cost.toFixed(2)}`);
    }
    lines.push(`💰 *Total: R$ ${cart.total.toFixed(2)}*`, '');
    lines.push('Deseja finalizar ou continuar comprando?');
    return lines.join('\n');
  }
}
