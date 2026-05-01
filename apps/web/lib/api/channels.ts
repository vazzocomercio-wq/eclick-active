import type { ChannelStatus, ChannelType } from '@eclick-active/shared';
import { api } from './client';

export interface ChannelView {
  id: string;
  org_id: string;
  channel_type: ChannelType;
  name: string;
  status: ChannelStatus;
  phone_number: string | null;
  external_id: string | null;
  webhook_url: string | null;
  last_webhook_at: string | null;
  error_message: string | null;
  config: Record<string, unknown>;
  has_credentials: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateChannelInput {
  channel_type: ChannelType;
  name: string;
  credentials?: Record<string, unknown>;
  phone_number?: string;
  external_id?: string;
  config?: Record<string, unknown>;
}

export interface UpdateChannelInput {
  name?: string;
  credentials?: Record<string, unknown>;
  phone_number?: string;
  config?: Record<string, unknown>;
  status?: ChannelStatus;
  paused?: boolean;
}

export const channelsApi = {
  list(signal?: AbortSignal): Promise<ChannelView[]> {
    return api.get<ChannelView[]>('/channels', { signal });
  },
  get(id: string, signal?: AbortSignal): Promise<ChannelView> {
    return api.get<ChannelView>(`/channels/${id}`, { signal });
  },
  create(input: CreateChannelInput): Promise<ChannelView> {
    return api.post<ChannelView>('/channels', input);
  },
  update(id: string, input: UpdateChannelInput): Promise<ChannelView> {
    return api.patch<ChannelView>(`/channels/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/channels/${id}`);
  },
};
