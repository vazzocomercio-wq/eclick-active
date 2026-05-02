import type { BusinessHoursConfig } from '@eclick-active/shared';
import { api } from './client';

export const businessHoursApi = {
  get(signal?: AbortSignal): Promise<BusinessHoursConfig> {
    return api.get<BusinessHoursConfig>('/settings/business-hours', { signal });
  },
  update(input: Partial<BusinessHoursConfig>): Promise<BusinessHoursConfig> {
    return api.patch<BusinessHoursConfig>('/settings/business-hours', input);
  },
};
