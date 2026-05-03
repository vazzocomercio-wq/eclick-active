import type {
  AgentAvailability,
  AppointmentDetail,
  AppointmentLocationType,
  AppointmentType,
  AvailabilitySlot,
} from '@eclick-active/shared';
import { api } from './client';

export interface ListAppointmentsParams {
  agent_id?: string;
  contact_id?: string;
  deal_id?: string;
  status?: 'scheduled' | 'confirmed' | 'cancelled' | 'completed' | 'no_show' | 'rescheduled';
  date_from?: string;
  date_to?: string;
  mine?: boolean;
}

export interface CreateAppointmentInput {
  title: string;
  start_time: string;
  end_time: string;
  description?: string;
  appointment_type_id?: string;
  contact_id?: string;
  deal_id?: string;
  conversation_id?: string;
  assigned_to?: string;
  location_type?: AppointmentLocationType;
  location_details?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateAppointmentInput {
  title?: string;
  description?: string;
  start_time?: string;
  end_time?: string;
  appointment_type_id?: string;
  assigned_to?: string;
  status?: 'scheduled' | 'confirmed' | 'cancelled' | 'completed' | 'no_show' | 'rescheduled';
  location_type?: AppointmentLocationType;
  location_details?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAppointmentTypeInput {
  name: string;
  description?: string;
  duration_minutes?: number;
  location_type?: AppointmentLocationType;
  location_details?: string;
  color?: string;
  buffer_minutes?: number;
  min_advance_hours?: number;
  max_per_day?: number;
  is_active?: boolean;
}

export const appointmentsApi = {
  // Appointments
  list(params: ListAppointmentsParams = {}, signal?: AbortSignal): Promise<AppointmentDetail[]> {
    return api.get<AppointmentDetail[]>('/appointments', {
      query: {
        ...params,
        mine: params.mine ? 'true' : undefined,
      },
      signal,
    });
  },
  getById(id: string, signal?: AbortSignal): Promise<AppointmentDetail> {
    return api.get<AppointmentDetail>(`/appointments/${id}`, { signal });
  },
  create(input: CreateAppointmentInput): Promise<AppointmentDetail> {
    return api.post<AppointmentDetail>('/appointments', input);
  },
  update(id: string, input: UpdateAppointmentInput): Promise<AppointmentDetail> {
    return api.patch<AppointmentDetail>(`/appointments/${id}`, input);
  },
  cancel(id: string, reason?: string): Promise<AppointmentDetail> {
    return api.post<AppointmentDetail>(`/appointments/${id}/cancel`, reason ? { reason } : {});
  },
  complete(id: string): Promise<AppointmentDetail> {
    return api.post<AppointmentDetail>(`/appointments/${id}/complete`);
  },
  markNoShow(id: string): Promise<AppointmentDetail> {
    return api.post<AppointmentDetail>(`/appointments/${id}/no-show`);
  },
  reschedule(id: string, start_time: string, end_time?: string): Promise<AppointmentDetail> {
    return api.post<AppointmentDetail>(`/appointments/${id}/reschedule`, {
      start_time,
      ...(end_time ? { end_time } : {}),
    });
  },

  // Calendar / today
  getCalendar(from: string, to: string, agentId?: string, signal?: AbortSignal) {
    return api.get<AppointmentDetail[]>('/appointments/calendar', {
      query: { from, to, ...(agentId ? { agent_id: agentId } : {}) },
      signal,
    });
  },
  getMyToday(signal?: AbortSignal): Promise<AppointmentDetail[]> {
    return api.get<AppointmentDetail[]>('/appointments/my/today', { signal });
  },

  // Slots
  getSlots(
    date: string,
    opts: { agent_id?: string; type_id?: string } = {},
    signal?: AbortSignal,
  ): Promise<AvailabilitySlot[]> {
    return api.get<AvailabilitySlot[]>('/appointments/slots', {
      query: { date, ...opts },
      signal,
    });
  },

  // Types
  listTypes(signal?: AbortSignal): Promise<AppointmentType[]> {
    return api.get<AppointmentType[]>('/appointments/types', { signal });
  },
  createType(input: CreateAppointmentTypeInput): Promise<AppointmentType> {
    return api.post<AppointmentType>('/appointments/types', input);
  },
  updateType(id: string, input: Partial<CreateAppointmentTypeInput>): Promise<AppointmentType> {
    return api.patch<AppointmentType>(`/appointments/types/${id}`, input);
  },
  deleteType(id: string): Promise<void> {
    return api.delete<void>(`/appointments/types/${id}`);
  },

  // Availability
  getAvailability(agentId: string, signal?: AbortSignal): Promise<AgentAvailability[]> {
    return api.get<AgentAvailability[]>(`/appointments/availability/${agentId}`, { signal });
  },
  setAvailability(input: {
    agent_id: string;
    schedule: Array<{ day_of_week: number; start_time: string; end_time: string; is_available?: boolean }>;
  }): Promise<AgentAvailability[]> {
    return api.post<AgentAvailability[]>('/appointments/availability', input);
  },
  setDateOverride(input: {
    agent_id: string;
    date: string;
    is_available: boolean;
    start_time?: string;
    end_time?: string;
  }): Promise<AgentAvailability> {
    return api.post<AgentAvailability>('/appointments/availability/override', input);
  },
};
