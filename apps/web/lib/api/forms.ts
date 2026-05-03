import type {
  Form,
  FormField,
  FormSubmission,
  FormSettings,
  FormBranding,
  FormStatus,
} from '@eclick-active/shared';
import { api } from './client';

export interface FormTemplateSummary {
  category: string;
  name: string;
  description: string;
  fields: FormField[];
  settings: FormSettings;
  branding: FormBranding;
}

export interface CreateFormInput {
  name: string;
  slug?: string;
  description?: string;
  fields?: FormField[];
  settings?: FormSettings;
  branding?: FormBranding;
  template_category?: string;
}

export interface UpdateFormInput {
  name?: string;
  slug?: string;
  description?: string;
  fields?: FormField[];
  settings?: FormSettings;
  branding?: FormBranding;
  status?: FormStatus;
}

export interface FormAnalytics {
  total: number;
  by_day: { date: string; count: number }[];
  by_source: { source: string; count: number }[];
  by_utm_source: { utm_source: string; count: number }[];
}

export const formsApi = {
  list(signal?: AbortSignal): Promise<Form[]> {
    return api.get<Form[]>('/forms', { signal });
  },
  get(id: string, signal?: AbortSignal): Promise<Form> {
    return api.get<Form>(`/forms/${id}`, { signal });
  },
  create(input: CreateFormInput): Promise<Form> {
    return api.post<Form>('/forms', input);
  },
  update(id: string, input: UpdateFormInput): Promise<Form> {
    return api.patch<Form>(`/forms/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/forms/${id}`);
  },
  publish(id: string): Promise<Form> {
    return api.post<Form>(`/forms/${id}/publish`);
  },
  pause(id: string): Promise<Form> {
    return api.post<Form>(`/forms/${id}/pause`);
  },
  duplicate(id: string): Promise<Form> {
    return api.post<Form>(`/forms/${id}/duplicate`);
  },
  submissions(
    id: string,
    options: { page?: number; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<{ data: FormSubmission[]; total: number }> {
    return api.get<{ data: FormSubmission[]; total: number }>(
      `/forms/${id}/submissions`,
      {
        query: {
          ...(options.page !== undefined ? { page: options.page } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
        },
        signal,
      },
    );
  },
  analytics(id: string, signal?: AbortSignal): Promise<FormAnalytics> {
    return api.get<FormAnalytics>(`/forms/${id}/analytics`, { signal });
  },
  templates(signal?: AbortSignal): Promise<FormTemplateSummary[]> {
    return api.get<FormTemplateSummary[]>('/forms/templates', { signal });
  },
};
