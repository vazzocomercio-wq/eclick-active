import { Injectable, Logger } from '@nestjs/common';
import { CommerceSettingsService } from '../../settings/commerce-settings.service';
import type { WhatsAppOrder, PaymentLink } from '../order.types';

interface MpPreference {
  id: string;
  init_point: string;
}

interface MpProviderConfig {
  provider: 'mercado_pago';
  enabled: boolean;
  access_token: string;
}

/**
 * Provider Mercado Pago — gera Preferência de pagamento via API REST.
 *
 * Token vem de commerce_settings.payment_providers (jsonb array).
 * Cada org tem seu próprio access_token.
 */
@Injectable()
export class MercadoPagoProvider {
  private readonly log = new Logger(MercadoPagoProvider.name);
  readonly name = 'mercado_pago' as const;

  constructor(private readonly settings: CommerceSettingsService) {}

  async isAvailable(orgId: string): Promise<boolean> {
    const cfg = await this.getProviderConfig(orgId);
    return Boolean(cfg && cfg.enabled && cfg.access_token);
  }

  async generateLink(order: WhatsAppOrder): Promise<PaymentLink> {
    const cfg = await this.getProviderConfig(order.org_id);
    if (!cfg || !cfg.access_token) {
      throw new Error('Mercado Pago não configurado pra esta org');
    }

    const publicUrl = process.env.PUBLIC_APP_URL ?? 'https://active.eclick.app.br';
    const apiUrl = process.env.PUBLIC_API_URL ?? 'https://api.eclick.app.br';

    const payload = {
      items: order.items.map((it) => ({
        title: it.name.slice(0, 250),
        quantity: it.quantity,
        unit_price: it.unit_price,
        currency_id: 'BRL',
      })),
      payer: {
        name: order.customer_name ?? undefined,
        phone: order.customer_phone
          ? { number: order.customer_phone }
          : undefined,
        email: order.customer_email ?? undefined,
      },
      back_urls: {
        success: `${publicUrl}/loja/pedido/${order.display_number}/sucesso`,
        failure: `${publicUrl}/loja/pedido/${order.display_number}/falha`,
        pending: `${publicUrl}/loja/pedido/${order.display_number}/pendente`,
      },
      external_reference: order.id,
      notification_url: `${apiUrl}/webhooks/mercadopago`,
      statement_descriptor: 'WHATSAPP COMMERCE',
    };

    try {
      const res = await fetch(
        'https://api.mercadopago.com/checkout/preferences',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cfg.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`MP ${res.status}: ${text.slice(0, 300)}`);
      }
      const body = (await res.json()) as MpPreference;
      return {
        url: body.init_point,
        external_id: body.id,
        provider: 'mercado_pago',
      };
    } catch (err) {
      this.log.warn(`MP generateLink falhou: ${String(err)}`);
      throw err;
    }
  }

  /**
   * Lookup do payment a partir de um payload de webhook do MP.
   * Retorna info pra atualizar order.
   */
  async fetchPaymentDetails(
    orgId: string,
    paymentId: string,
  ): Promise<{
    status: string;
    external_reference: string | null;
    transaction_amount: number;
    payment_method_id: string;
  } | null> {
    const cfg = await this.getProviderConfig(orgId);
    if (!cfg) return null;

    try {
      const res = await fetch(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
          headers: { Authorization: `Bearer ${cfg.access_token}` },
        },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as {
        status: string;
        external_reference: string | null;
        transaction_amount: number;
        payment_method_id: string;
      };
      return body;
    } catch (err) {
      this.log.warn(`MP fetchPaymentDetails falhou: ${String(err)}`);
      return null;
    }
  }

  private async getProviderConfig(
    orgId: string,
  ): Promise<MpProviderConfig | null> {
    try {
      const settings = await this.settings.get(orgId);
      const providers =
        (settings.payment_providers as Array<Record<string, unknown>>) ?? [];
      const mp = providers.find(
        (p) => (p as { provider?: string }).provider === 'mercado_pago',
      );
      if (!mp) return null;
      return mp as unknown as MpProviderConfig;
    } catch {
      return null;
    }
  }
}
