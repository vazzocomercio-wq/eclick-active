import { Controller, Post, Body, Logger, Query } from '@nestjs/common';
import { WhatsAppOrderService } from '../order/order.service';
import { MercadoPagoProvider } from '../order/providers/mercado-pago.provider';
import { SaleFlowService } from '../sale-flow/sale-flow.service';

interface MpWebhookPayload {
  type?: string;
  action?: string;
  data?: { id?: string };
}

/**
 * Endpoints públicos de webhook de pagamento. Sem auth — Mercado Pago
 * envia POST direto. Validação adicional pode ser adicionada via
 * verify_signature header do MP futuramente.
 */
@Controller('webhooks')
export class PaymentWebhooksController {
  private readonly log = new Logger(PaymentWebhooksController.name);

  constructor(
    private readonly orders: WhatsAppOrderService,
    private readonly mp: MercadoPagoProvider,
    private readonly saleFlow: SaleFlowService,
  ) {}

  /**
   * MP envia 2 tipos de notification:
   *   - type=payment, action=payment.created/updated → buscar payment
   *   - type=merchant_order → ignorar (consolidação)
   */
  @Post('mercadopago')
  async mercadoPago(
    @Body() body: MpWebhookPayload,
    @Query('topic') topicQuery?: string,
  ): Promise<{ ok: true }> {
    try {
      const type = body.type ?? topicQuery;
      const paymentId = body.data?.id;
      if (type !== 'payment' || !paymentId) {
        return { ok: true };
      }

      // Pra resolver org, precisamos primeiro buscar uma order com
      // payment_id correspondente — mas o webhook vem antes do MP
      // associar o payment_id. Estratégia: pegar external_reference
      // (que é nosso order.id) via API do MP.
      // Como não temos org_id no payload, tentamos via metadata da
      // order. Pra MVP simplificado: tentar buscar a order direto
      // pelo external_reference depois.

      // Tenta um provider lookup global — vai funcionar pra orgs com
      // MP configurado. Se múltiplas orgs com MP, requer adicionar
      // user_id no metadata pra desambiguar (fora de escopo).
      // Fallback: faz fetch sequencial — pega 1ª org que retornar.
      const orgIds = await this.guessOrgsWithMp();
      let payment: Awaited<
        ReturnType<MercadoPagoProvider['fetchPaymentDetails']>
      > = null;
      let resolvedOrgId: string | null = null;
      for (const orgId of orgIds) {
        payment = await this.mp.fetchPaymentDetails(orgId, paymentId);
        if (payment) {
          resolvedOrgId = orgId;
          break;
        }
      }
      if (!payment || !resolvedOrgId || !payment.external_reference) {
        this.log.warn(`MP webhook: payment ${paymentId} sem external_ref`);
        return { ok: true };
      }

      const order = await this.orders.findByExternalRef(
        payment.external_reference,
      );
      if (!order) {
        this.log.warn(
          `MP webhook: order ${payment.external_reference} não existe`,
        );
        return { ok: true };
      }

      if (payment.status === 'approved' && order.payment_status !== 'paid') {
        const paid = await this.orders.markPaid(order.org_id, order.id, {
          payment_id: paymentId,
        });
        this.log.log(
          `MP webhook: order ${order.display_number} marcado como pago`,
        );
        // Fase C (vendedora IA): se o pedido nasceu do sale flow, avisa o
        // cliente na conversa de origem e fecha o sale_flow ('completed').
        // Fire-and-forget: falha aqui nunca quebra o ACK do webhook.
        void this.saleFlow.onOrderPaid(paid).catch((err: unknown) =>
          this.log.warn(
            `[sale-flow] pós-pagamento falhou (não fatal): ${String(err)}`,
          ),
        );
      }
    } catch (err) {
      this.log.error(`MP webhook erro: ${String(err)}`);
    }
    return { ok: true };
  }

  private async guessOrgsWithMp(): Promise<string[]> {
    // Lista orgs com mercado_pago em payment_providers via service
    // simplificado — direto via supabase admin client
    try {
      const { data } = await (this.orders as unknown as {
        supabase: {
          adminClient: {
            from: (t: string) => {
              select: (s: string) => {
                eq: (k: string, v: boolean) => Promise<{
                  data: Array<{ org_id: string; payment_providers: unknown }> | null;
                }>;
              };
            };
          };
        };
      }).supabase.adminClient
        .from('whatsapp_commerce_settings')
        .select('org_id, payment_providers')
        .eq('enabled', true);
      const rows = data ?? [];
      return rows
        .filter((r) =>
          ((r.payment_providers as Array<Record<string, unknown>>) ?? []).some(
            (p) => (p as { provider?: string }).provider === 'mercado_pago',
          ),
        )
        .map((r) => r.org_id);
    } catch {
      return [];
    }
  }
}
