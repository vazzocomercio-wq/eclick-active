import { api } from './client';

// ─────────────────────────────────────────────────────────────
// Ad Integrations (Meta/Google OAuth + list/disconnect)
// ─────────────────────────────────────────────────────────────

export type AdPlatform = 'meta' | 'google';
export type AdIntegrationStatus =
  | 'active'
  | 'token_expired'
  | 'error'
  | 'disconnected';

export interface AdIntegration {
  id: string;
  platform: AdPlatform;
  ad_account_id: string;
  account_name: string | null;
  status: AdIntegrationStatus;
  scope: string | null;
  expires_at: string | null;
  last_sync_at: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SyncResult {
  integration_id: string;
  platform: AdPlatform;
  campaigns_upserted: number;
  metrics_upserted: number;
  campaigns_missing: number;
  duration_ms: number;
}

export const adIntegrationsApi = {
  list: () => api.get<AdIntegration[]>('/ad-integrations'),
  disconnect: (id: string) => api.delete<void>(`/ad-integrations/${id}`),
  syncManual: (id: string) => api.post<SyncResult>(`/ad-integrations/${id}/sync`),
  getMetaConnectUrl: () => api.get<{ url: string }>('/ad-integrations/meta/connect'),
  getGoogleConnectUrl: () => api.get<{ url: string }>('/ad-integrations/google/connect'),
};

// ─────────────────────────────────────────────────────────────
// Ad Metrics (catalog + configs)
// ─────────────────────────────────────────────────────────────

export interface AdMetricCatalogEntry {
  key: string;
  platform: 'meta' | 'google' | 'shared';
  display_name: string;
  description: string;
  data_type: string;
  direction: 'higher_better' | 'lower_better' | 'neutral';
  aggregation: string;
  unit: string;
  category: string;
  is_core: boolean;
}

export type ThresholdMode = 'manual' | 'auto';
export type AggregationWindow = 'day' | '7d' | '30d';

export interface AdMetricConfig {
  id: string;
  metric_key: string;
  enabled: boolean;
  threshold_mode: ThresholdMode;
  target_value: number | null;
  warning_pct: number;
  critical_pct: number;
  baseline_window_days: number;
  aggregation_window: AggregationWindow;
  routing_manager_ids: string[];
  notes: string | null;
  catalog: {
    display_name: string;
    description: string;
    data_type: string;
    direction: string;
    aggregation: string;
    unit: string;
    category: string;
    platform: string;
    is_core: boolean;
  };
  virtual: boolean;
  updated_at: string | null;
}

export interface UpdateMetricConfigInput {
  enabled?: boolean;
  threshold_mode?: ThresholdMode;
  target_value?: number | null;
  warning_pct?: number;
  critical_pct?: number;
  baseline_window_days?: number;
  aggregation_window?: AggregationWindow;
  routing_manager_ids?: string[];
  notes?: string | null;
}

export const adMetricsApi = {
  listCatalog: (platform?: 'meta' | 'google' | 'shared' | 'all') =>
    api.get<AdMetricCatalogEntry[]>('/ad-metrics/catalog', { query: { platform } }),
  listConfigs: (platform?: 'meta' | 'google' | 'shared' | 'all') =>
    api.get<AdMetricConfig[]>('/ad-metrics/configs', { query: { platform } }),
  updateConfig: (metricKey: string, input: UpdateMetricConfigInput) =>
    api.patch<AdMetricConfig>(`/ad-metrics/configs/${metricKey}`, input),
};

// ─────────────────────────────────────────────────────────────
// Metric Coverage — audit de configs órfãs (signal detector)
// Endpoint exposto em adSignalsApi.metricCoverage() (mais abaixo).
// ─────────────────────────────────────────────────────────────

export type CoverageStaticClass =
  | 'direct'
  | 'raw_jsonb'
  | 'text_incompatible'
  | 'computed_only';

export type CoverageStatus =
  | 'healthy'
  | 'no_data'
  | 'orphan_no_value'
  | 'text_incompatible'
  | 'computed_only'
  | 'disabled';

export interface CoverageItem {
  metric_key: string;
  display_name: string;
  platform: string;
  category: string;
  enabled: boolean;
  static_class: CoverageStaticClass;
  status: CoverageStatus;
  coverage_pct: number;
  rows_checked: number;
  rows_with_value: number;
  last_seen_with_value: string | null;
  recommendation: string;
}

export interface CoverageReport {
  enabled_count: number;
  orphan_count: number;
  total_configs: number;
  window_days: number;
  no_data_at_all: boolean;
  items: CoverageItem[];
}

// ─────────────────────────────────────────────────────────────
// Alert Managers
// ─────────────────────────────────────────────────────────────

export type AlertManagerStatus = 'pending_verification' | 'active' | 'suspended';

export interface AlertManager {
  id: string;
  name: string;
  phone_masked: string;
  department: string | null;
  channel_id: string | null;
  preferences: Record<string, unknown>;
  status: AlertManagerStatus;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAlertManagerInput {
  name: string;
  phone: string;
  department?: string;
  channel_id?: string;
  preferences?: Record<string, unknown>;
}

export interface UpdateAlertManagerInput {
  name?: string;
  department?: string;
  channel_id?: string;
  preferences?: Record<string, unknown>;
  status?: 'active' | 'suspended';
}

export const alertManagersApi = {
  list: () => api.get<AlertManager[]>('/alert-managers'),
  create: (input: CreateAlertManagerInput) =>
    api.post<AlertManager>('/alert-managers', input),
  update: (id: string, input: UpdateAlertManagerInput) =>
    api.patch<AlertManager>(`/alert-managers/${id}`, input),
  remove: (id: string) => api.delete<void>(`/alert-managers/${id}`),
  verifyPhone: (id: string) =>
    api.post<{ ok: true; expires_in_minutes: number }>(`/alert-managers/${id}/verify-phone`),
  confirmPhone: (id: string, code: string) =>
    api.post<AlertManager>(`/alert-managers/${id}/confirm-phone`, { code }),
};

// ─────────────────────────────────────────────────────────────
// Alert Routing Rules
// ─────────────────────────────────────────────────────────────

export type DeliveryMode =
  | 'immediate'
  | 'digest_8h'
  | 'digest_14h'
  | 'digest_18h'
  | 'weekly';

export interface AlertRoutingRule {
  id: string;
  name: string | null;
  signal_type: string;
  min_severity: 'warning' | 'critical';
  manager_ids: string[];
  delivery_mode: DeliveryMode;
  business_hours_only: boolean;
  enabled: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface CreateRoutingRuleInput {
  name?: string;
  signal_type: string;
  min_severity?: 'warning' | 'critical';
  manager_ids: string[];
  delivery_mode: DeliveryMode;
  business_hours_only?: boolean;
  enabled?: boolean;
  priority?: number;
}

export type UpdateRoutingRuleInput = Partial<CreateRoutingRuleInput>;

export const alertRoutingApi = {
  list: () => api.get<AlertRoutingRule[]>('/alert-routing-rules'),
  create: (input: CreateRoutingRuleInput) =>
    api.post<AlertRoutingRule>('/alert-routing-rules', input),
  update: (id: string, input: UpdateRoutingRuleInput) =>
    api.patch<AlertRoutingRule>(`/alert-routing-rules/${id}`, input),
  remove: (id: string) => api.delete<void>(`/alert-routing-rules/${id}`),
};

// ─────────────────────────────────────────────────────────────
// Signals + Deliveries (read-only listing + ack)
// ─────────────────────────────────────────────────────────────

export interface AdSignal {
  id: string;
  signal_type: string;
  metric_key: string | null;
  severity: 'warning' | 'critical';
  current_value: number | null;
  threshold_value: number | null;
  payload: Record<string, unknown>;
  status: 'pending' | 'sent' | 'acked' | 'expired';
  generated_at: string;
  sent_at: string | null;
  ack_at: string | null;
  campaign: { id: string; name: string; platform: string } | null;
}

export const adSignalsApi = {
  list: (status?: string, limit = 100) =>
    api.get<AdSignal[]>('/ad-signals', {
      query: { status, limit },
    }),
  ack: (id: string, note?: string) =>
    api.post<{ ok: true }>(`/ad-signals/${id}/ack`, note ? { note } : {}),
  detect: () =>
    api.post<{
      org_id: string;
      layer1: number;
      layer2: number;
      layer3: number;
      total: number;
      duration_ms: number;
    }>('/ad-signals/detect'),
  metricCoverage: (signal?: AbortSignal) =>
    api.get<CoverageReport>('/ad-signals/metric-coverage', { signal }),
};

export interface AlertDelivery {
  id: string;
  manager_id: string;
  manager_name: string | null;
  signal_id: string | null;
  signals_batch: string[];
  delivery_mode: string;
  message_text: string | null;
  status: string;
  narrator: string;
  retry_count: number;
  channel_message_id: string | null;
  error_message: string | null;
  generated_at: string;
  sent_at: string | null;
  ack_at: string | null;
}

export const alertDeliveriesApi = {
  list: (params?: { status?: string; manager_id?: string; limit?: number }) =>
    api.get<AlertDelivery[]>('/alert-deliveries', {
      query: {
        status: params?.status,
        manager_id: params?.manager_id,
        limit: params?.limit,
      },
    }),
  ack: (id: string) => api.post<{ ok: true }>(`/alert-deliveries/${id}/ack`),
};
