import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type {
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEndpoint,
  WebhookEventType,
} from '@eclick-active/shared';

/**
 * Payload arbitrário aceito por `deliver()` — internamente serializado via
 * JSON.stringify, então qualquer estrutura serializável funciona. Mais
 * permissivo que o `Json` strict do shared (que recusa `Record<string,unknown>`).
 */
type WebhookPayload = unknown;
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  CreateWebhookEndpointDto,
  UpdateWebhookEndpointDto,
} from './dto/webhook-endpoint.dto';

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
/** Backoff em ms: tentativa 1 imediata, 2 após 1s, 3 após 30s, 4 após 5min */
const BACKOFF_MS = [0, 1_000, 30_000, 5 * 60_000];
const AUTO_DEACTIVATE_THRESHOLD = 50;

/**
 * Webhooks de saída — registro de URLs externas + delivery com HMAC + retry.
 *
 * Fluxo de delivery:
 *   1. Pra cada evento emitido (ex: deal:won), o caller chama `deliver(orgId, eventType, payload)`
 *   2. Service busca endpoints ativos da org que escutam esse eventType
 *   3. Pra cada um, agenda `attemptDelivery` (com retry interno até 3x)
 *   4. Cada tentativa registra row em `webhook_deliveries` com status final
 *   5. Se 50 falhas consecutivas, desativa o endpoint e loga warning
 *
 * Retry em-processo (setTimeout). Em produção pesada, migrar pra fila dedicada
 * (BullMQ/Redis) — out-of-scope MVP.
 */
@Injectable()
export class OutboundWebhookService {
  private readonly logger = new Logger(OutboundWebhookService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ──────────────────────────────────────────────────────────
  // CRUD endpoints
  // ──────────────────────────────────────────────────────────

  async list(orgId: string): Promise<WebhookEndpoint[]> {
    const { data, error } = await this.supabase.adminClient
      .from('webhook_endpoints')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as WebhookEndpoint[];
  }

  async create(orgId: string, dto: CreateWebhookEndpointDto): Promise<WebhookEndpoint> {
    const { data, error } = await this.supabase.adminClient
      .from('webhook_endpoints')
      .insert({
        org_id: orgId,
        name: dto.name.trim(),
        url: dto.url,
        events: dto.events,
        secret: dto.secret ?? null,
        is_active: dto.is_active ?? true,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Failed to create endpoint');
    }
    return data as WebhookEndpoint;
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateWebhookEndpointDto,
  ): Promise<WebhookEndpoint> {
    await this.assertEndpointInOrg(orgId, id);
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.url !== undefined) patch.url = dto.url;
    if (dto.events !== undefined) patch.events = dto.events;
    if (dto.secret !== undefined) patch.secret = dto.secret;
    if (dto.is_active !== undefined) {
      patch.is_active = dto.is_active;
      // Reativando: zera failure_count pra dar nova chance
      if (dto.is_active === true) patch.failure_count = 0;
    }

    const { data, error } = await this.supabase.adminClient
      .from('webhook_endpoints')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Failed to update endpoint');
    }
    return data as WebhookEndpoint;
  }

  async remove(orgId: string, id: string): Promise<void> {
    await this.assertEndpointInOrg(orgId, id);
    const { error } = await this.supabase.adminClient
      .from('webhook_endpoints')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);
  }

  // ──────────────────────────────────────────────────────────
  // Test endpoint — envia payload de exemplo
  // ──────────────────────────────────────────────────────────

  async test(orgId: string, id: string): Promise<WebhookDelivery> {
    const endpoint = await this.assertEndpointInOrg(orgId, id);
    const samplePayload = {
      test: true,
      timestamp: new Date().toISOString(),
      message: 'Payload de teste — se você está lendo isso, seu webhook funciona!',
    } satisfies Record<string, unknown>;

    return this.attemptDelivery(endpoint, 'automation.executed', samplePayload, 1);
  }

  // ──────────────────────────────────────────────────────────
  // Deliveries — read + retry
  // ──────────────────────────────────────────────────────────

  async getDeliveries(
    orgId: string,
    endpointId: string,
    limit = 50,
  ): Promise<WebhookDelivery[]> {
    await this.assertEndpointInOrg(orgId, endpointId);
    const { data, error } = await this.supabase.adminClient
      .from('webhook_deliveries')
      .select('*')
      .eq('org_id', orgId)
      .eq('endpoint_id', endpointId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as WebhookDelivery[];
  }

  /**
   * Reenvia uma delivery que falhou. Resetea attempt=1 (re-inicia backoff).
   */
  async retryDelivery(orgId: string, deliveryId: string): Promise<WebhookDelivery> {
    const { data: existing, error } = await this.supabase.adminClient
      .from('webhook_deliveries')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', deliveryId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!existing) throw new NotFoundException(`Delivery ${deliveryId} não encontrada`);

    const original = existing as WebhookDelivery;
    if (original.status === 'success') {
      throw new ConflictException('Delivery já foi entregue com sucesso.');
    }

    const endpoint = await this.assertEndpointInOrg(orgId, original.endpoint_id);
    return this.attemptDelivery(endpoint, original.event_type, original.payload, 1);
  }

  // ──────────────────────────────────────────────────────────
  // PUBLIC API: deliver — chamado fire-and-forget de outros services
  // ──────────────────────────────────────────────────────────

  /**
   * Despacha o evento pra todos os endpoints ativos da org que escutam
   * `eventType`. Cada delivery roda em fire-and-forget com retry interno.
   */
  async deliver(
    orgId: string,
    eventType: WebhookEventType,
    payload: WebhookPayload,
  ): Promise<void> {
    try {
      const { data, error } = await this.supabase.adminClient
        .from('webhook_endpoints')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .contains('events', [eventType]);

      if (error) {
        this.logger.warn(`deliver query failed: ${error.message}`);
        return;
      }

      const endpoints = (data ?? []) as WebhookEndpoint[];
      for (const ep of endpoints) {
        // Fire-and-forget — cada endpoint independente
        void this.attemptDelivery(ep, eventType, payload, 1).catch((err) => {
          this.logger.warn(
            `deliver to ${ep.id} failed (top-level): ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    } catch (err) {
      this.logger.warn(
        `deliver caught: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────

  /**
   * Tenta entregar uma vez. Em falha, agenda retry com backoff. Persiste
   * row em `webhook_deliveries` com status final + atualiza endpoint stats.
   */
  private async attemptDelivery(
    endpoint: WebhookEndpoint,
    eventType: WebhookEventType,
    payload: WebhookPayload,
    attempt: number,
  ): Promise<WebhookDelivery> {
    const start = performance.now();

    const body = JSON.stringify({
      event: eventType,
      org_id: endpoint.org_id,
      delivered_at: new Date().toISOString(),
      data: payload,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': eventType,
      'X-Webhook-Attempt': String(attempt),
    };
    if (endpoint.secret) {
      const sig = createHmac('sha256', endpoint.secret).update(body).digest('hex');
      headers['X-Webhook-Signature'] = `sha256=${sig}`;
    }

    let status: WebhookDeliveryStatus = 'failed';
    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;
    let responseTimeMs: number | null = null;

    try {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), DELIVERY_TIMEOUT_MS);
      try {
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers,
          body,
          signal: ctrl.signal,
        });
        clearTimeout(timeoutId);
        responseStatus = response.status;
        // Lê body com cap de 4KB pra não estourar storage
        const text = await response.text().catch(() => '');
        responseBody = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
        responseTimeMs = Math.round(performance.now() - start);
        if (response.ok) {
          status = 'success';
        } else {
          error = `HTTP ${response.status} ${response.statusText}`;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      responseTimeMs = Math.round(performance.now() - start);
      const e = err as { name?: string; message?: string };
      error =
        e?.name === 'AbortError'
          ? `Timeout após ${DELIVERY_TIMEOUT_MS}ms`
          : e?.message ?? String(err);
    }

    // Persiste a delivery
    const delivery = await this.persistDelivery({
      endpoint,
      eventType,
      payload,
      status,
      attempt,
      responseStatus,
      responseBody,
      responseTimeMs,
      error,
    });

    // Atualiza stats do endpoint
    await this.updateEndpointStats(endpoint.id, status === 'success');

    // Schedule retry se ainda há tentativas
    if (status === 'failed' && attempt < MAX_ATTEMPTS) {
      const delay = BACKOFF_MS[attempt] ?? 60_000;
      setTimeout(() => {
        void this.attemptDelivery(endpoint, eventType, payload, attempt + 1).catch(
          (err) => {
            this.logger.warn(
              `retry attempt ${attempt + 1} for ${endpoint.id} failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          },
        );
      }, delay);
    }

    return delivery;
  }

  private async persistDelivery(args: {
    endpoint: WebhookEndpoint;
    eventType: WebhookEventType;
    payload: WebhookPayload;
    status: WebhookDeliveryStatus;
    attempt: number;
    responseStatus: number | null;
    responseBody: string | null;
    responseTimeMs: number | null;
    error: string | null;
  }): Promise<WebhookDelivery> {
    const { data, error } = await this.supabase.adminClient
      .from('webhook_deliveries')
      .insert({
        endpoint_id: args.endpoint.id,
        org_id: args.endpoint.org_id,
        event_type: args.eventType,
        payload: args.payload,
        status: args.status,
        attempt: args.attempt,
        response_status: args.responseStatus,
        response_body: args.responseBody,
        response_time_ms: args.responseTimeMs,
        error: args.error,
      })
      .select('*')
      .single();
    if (error || !data) {
      this.logger.warn(`persistDelivery failed: ${error?.message}`);
      // Devolve um shim com os dados em memória pra não quebrar callers.
      // `payload` é cast pro tipo strict — armazenamos só pra log de debug.
      return {
        id: 'persist-failed',
        endpoint_id: args.endpoint.id,
        org_id: args.endpoint.org_id,
        event_type: args.eventType,
        payload: args.payload as never,
        response_status: args.responseStatus,
        response_body: args.responseBody,
        response_time_ms: args.responseTimeMs,
        attempt: args.attempt,
        status: args.status,
        error: args.error,
        created_at: new Date().toISOString(),
      };
    }
    return data as WebhookDelivery;
  }

  private async updateEndpointStats(endpointId: string, success: boolean): Promise<void> {
    if (success) {
      await this.supabase.adminClient
        .from('webhook_endpoints')
        .update({
          failure_count: 0,
          last_success_at: new Date().toISOString(),
        })
        .eq('id', endpointId);
      return;
    }

    // Em falha: incrementa failure_count + auto-desativa se passar do limite
    const { data: current } = await this.supabase.adminClient
      .from('webhook_endpoints')
      .select('failure_count')
      .eq('id', endpointId)
      .maybeSingle();
    const next = ((current as { failure_count: number } | null)?.failure_count ?? 0) + 1;
    const patch: Record<string, unknown> = {
      failure_count: next,
      last_failure_at: new Date().toISOString(),
    };
    if (next >= AUTO_DEACTIVATE_THRESHOLD) {
      patch.is_active = false;
      this.logger.warn(
        `Endpoint ${endpointId} auto-desativado após ${next} falhas consecutivas.`,
      );
    }
    await this.supabase.adminClient
      .from('webhook_endpoints')
      .update(patch)
      .eq('id', endpointId);
  }

  private async assertEndpointInOrg(
    orgId: string,
    id: string,
  ): Promise<WebhookEndpoint> {
    const { data, error } = await this.supabase.adminClient
      .from('webhook_endpoints')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Webhook endpoint ${id} não encontrado.`);
    return data as WebhookEndpoint;
  }
}
