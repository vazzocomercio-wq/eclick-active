import type { ShippingAddress } from '../order/order.types';

/**
 * Tipos do Sale Flow (Vendedora IA — Fase C: fechar a venda no WhatsApp).
 *
 * O estado da venda vive em `conversations.metadata.sale_flow` — chave
 * PRÓPRIA, separada de `concierge_state` (fase A/B) e sempre gravada via
 * RPC `conversation_merge_metadata` (merge atômico, migração 111) pra não
 * haver lost-update com os outros gravadores da mesma conversa.
 */

export type SaleFlowState =
  /** Interesse de compra confirmado — perguntamos a quantidade. */
  | 'collecting_quantity'
  /** Quantidade ok, entrega exige endereço — coletando. */
  | 'collecting_address'
  /** Resumo do pedido enviado — aguardando "sim" explícito do cliente. */
  | 'awaiting_confirmation'
  /** Pedido criado + link de pagamento enviado — aguardando webhook. */
  | 'awaiting_payment'
  /** Pagamento confirmado — venda concluída. */
  | 'completed'
  /** Cliente desistiu — flow encerrado, Lia volta ao comportamento normal. */
  | 'cancelled'
  /** Transferido pro humano — Lia SILENCIA nesta conversa. */
  | 'handed_off';

/** Snapshot do produto no início do flow. O preço é SEMPRE re-consultado
 *  na fonte (bridge + whatsapp_price_override) antes de criar o pedido —
 *  este snapshot serve pra mensagens/briefings, nunca aritmética final. */
export interface SaleFlowProductSnapshot {
  product_id: string;
  title: string;
  sku: string | null;
  /** Preço unitário da FONTE (override > catálogo). Nunca do texto do LLM. */
  unit_price: number;
  stock_quantity: number | null;
}

export interface SaleFlowShipping {
  mode: 'pickup' | 'flat' | 'free';
  /** Custo em BRL com 2 casas. */
  cost: number;
  /** Rótulo humano ("Retirada na loja", "Frete fixo", "Frete grátis"). */
  label: string;
  requires_address: boolean;
  address: ShippingAddress | null;
}

export interface SaleFlowMeta {
  state: SaleFlowState;
  product: SaleFlowProductSnapshot;
  quantity: number | null;
  shipping: SaleFlowShipping | null;
  order_id: string | null;
  order_display: string | null;
  payment_url: string | null;
  pix_copy_paste: string | null;
  payment_provider: string | null;
  /** Tentativas de parse falhas NO estado atual (reseta a cada transição). */
  retries: number;
  handoff_reason: string | null;
  started_at: string;
  updated_at: string;
}

/** Resultado do parse de shipping_config (jsonb livre da org). */
export interface ParsedShippingConfig {
  mode: 'pickup' | 'flat' | 'free';
  cost: number;
  label: string;
  requires_address: boolean;
  pickup_address: string | null;
}

/** Flags universais detectáveis em qualquer turno do flow. */
export interface TurnFlags {
  wants_human: boolean;
  wants_cancel: boolean;
  price_negotiation: boolean;
}
