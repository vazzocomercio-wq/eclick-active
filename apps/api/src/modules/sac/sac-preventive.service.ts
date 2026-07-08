import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { BridgeService } from '../bridge/bridge.service';
import { SacTicketsService } from './sac-tickets.service';

interface ContactRow {
  id: string;
  org_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * SAC preventivo: detecta pedidos atrasados via bridge SaaS e cria
 * tickets preventivos para o agente entrar em contato proativamente.
 *
 * Só roda se a org tem bridge SaaS ativa.
 */
@Injectable()
export class SacPreventiveService {
  private readonly log = new Logger(SacPreventiveService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly bridge: BridgeService,
    private readonly tickets: SacTicketsService,
  ) {}

  /** Roda scan em todas as orgs com SaaS ativo. */
  async runScanForAllOrgs(): Promise<void> {
    try {
      const { data: orgs, error } = await this.supabase.adminClient
        .from('organizations')
        .select('id')
        .limit(500);
      if (error) throw error;
      const list = (orgs ?? []) as Array<{ id: string }>;
      for (const o of list) {
        try {
          await this.runScanForOrg(o.id);
        } catch (err) {
          this.log.warn(`scan org ${o.id} falhou: ${String(err)}`);
        }
      }
    } catch (err) {
      this.log.warn(`runScanForAllOrgs falhou: ${String(err)}`);
    }
  }

  /** Scan individual de uma org. */
  async runScanForOrg(orgId: string): Promise<{ created: number }> {
    if (!(await this.bridge.hasSaasIntegration(orgId))) {
      return { created: 0 };
    }

    const recent = await this.bridge.getRecentOrders(orgId, 200);
    const now = Date.now();
    const delayed = recent.filter((o) => {
      if (!o.shipping_estimated_delivery) return false;
      if (
        o.shipping_status === 'delivered' ||
        o.shipping_status === 'cancelled'
      ) {
        return false;
      }
      return new Date(o.shipping_estimated_delivery).getTime() < now;
    });

    let created = 0;
    for (const order of delayed) {
      const phone = order.buyer_phone ?? null;
      const email = order.buyer_email ?? null;
      if (!phone && !email) continue;

      // Acha contato no Active
      let contact = await this.findContact(orgId, phone, email);

      // Se não existe, cria a partir do pedido
      if (!contact) {
        contact = await this.createContactFromOrder(orgId, {
          phone,
          email,
          name: order.buyer_nickname ?? null,
        });
        if (!contact) continue;
      }

      // Verifica se já tem ticket aberto pra esse pedido
      const existing = await this.findExistingTicket(
        orgId,
        order.marketplace_order_id ?? null,
      );
      if (existing) continue;

      const daysDelayed = Math.ceil(
        (now - new Date(order.shipping_estimated_delivery as string).getTime()) /
          86_400_000,
      );

      try {
        await this.tickets.createPreventive(
          orgId,
          contact.id,
          {
            marketplace: order.marketplace,
            marketplace_id: order.marketplace_order_id,
            tracking: order.shipping_tracking_number,
            value: order.total_amount,
            status: order.shipping_status,
            raw: order as unknown as Record<string, unknown>,
          },
          daysDelayed,
        );
        created += 1;
      } catch (err) {
        this.log.warn(
          `createPreventive falhou pra org=${orgId} order=${order.id}: ${String(err)}`,
        );
      }
    }

    if (created > 0) {
      this.log.log(`SAC preventivo: ${created} tickets criados pra org=${orgId}`);
    }
    return { created };
  }

  // ─── helpers ───────────────────────────────────────

  private async findContact(
    orgId: string,
    phone: string | null,
    email: string | null,
  ): Promise<ContactRow | null> {
    if (!phone && !email) return null;
    // Queries .eq() separadas em vez de .or() interpolado — dados do comprador
    // (phone/email do marketplace) com vírgula/parênteses quebrariam o parser
    // do PostgREST ou injetariam condições. Prioriza telefone, cai pra e-mail.
    const base = () =>
      this.supabase.adminClient
        .from('contacts')
        .select('id, org_id, full_name, phone, email')
        .eq('org_id', orgId)
        .limit(1);

    if (phone) {
      const { data } = await base().eq('phone', phone).maybeSingle();
      if (data) return data as ContactRow;
    }
    if (email) {
      const { data } = await base().eq('email', email).maybeSingle();
      if (data) return data as ContactRow;
    }
    return null;
  }

  private async createContactFromOrder(
    orgId: string,
    input: { phone: string | null; email: string | null; name: string | null },
  ): Promise<ContactRow | null> {
    try {
      const { data, error } = await this.supabase.adminClient
        .from('contacts')
        .insert({
          org_id: orgId,
          full_name: input.name ?? input.phone ?? input.email ?? 'Cliente',
          phone: input.phone,
          email: input.email,
          source: 'sac_preventive',
        })
        .select('id, org_id, full_name, phone, email')
        .single();
      if (error) throw error;
      return data as ContactRow;
    } catch (err) {
      this.log.warn(`createContactFromOrder falhou: ${String(err)}`);
      return null;
    }
  }

  private async findExistingTicket(
    orgId: string,
    marketplaceOrderId: string | null,
  ): Promise<{ id: string } | null> {
    if (!marketplaceOrderId) return null;
    const { data } = await this.supabase.adminClient
      .from('sac_tickets')
      .select('id')
      .eq('org_id', orgId)
      .eq('order_marketplace_id', marketplaceOrderId)
      .not('status', 'in', '("resolved","cancelled")')
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null) ?? null;
  }
}
