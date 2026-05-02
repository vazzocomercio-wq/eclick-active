import type {
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEventType,
} from '@eclick-active/shared';
import { api } from './client';

export interface CreateWebhookEndpointInput {
  name: string;
  url: string;
  events: WebhookEventType[];
  secret?: string | null;
  is_active?: boolean;
}

export interface UpdateWebhookEndpointInput {
  name?: string;
  url?: string;
  events?: WebhookEventType[];
  secret?: string | null;
  is_active?: boolean;
}

export const outboundWebhooksApi = {
  list(signal?: AbortSignal): Promise<WebhookEndpoint[]> {
    return api.get<WebhookEndpoint[]>('/webhooks/endpoints', { signal });
  },
  create(input: CreateWebhookEndpointInput): Promise<WebhookEndpoint> {
    return api.post<WebhookEndpoint>('/webhooks/endpoints', input);
  },
  update(id: string, input: UpdateWebhookEndpointInput): Promise<WebhookEndpoint> {
    return api.patch<WebhookEndpoint>(`/webhooks/endpoints/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/webhooks/endpoints/${id}`);
  },
  test(id: string): Promise<WebhookDelivery> {
    return api.post<WebhookDelivery>(`/webhooks/endpoints/${id}/test`);
  },
  getDeliveries(id: string, signal?: AbortSignal): Promise<WebhookDelivery[]> {
    return api.get<WebhookDelivery[]>(`/webhooks/endpoints/${id}/deliveries`, { signal });
  },
  retryDelivery(deliveryId: string): Promise<WebhookDelivery> {
    return api.post<WebhookDelivery>(`/webhooks/deliveries/${deliveryId}/retry`);
  },
};

export type { WebhookDelivery, WebhookEndpoint, WebhookEventType };
