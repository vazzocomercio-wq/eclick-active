import type { ISODateString, UUID } from './common';

export type AppointmentLocationType = 'online' | 'presencial' | 'telefone' | 'flexivel';

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show'
  | 'rescheduled';

export type ExternalCalendarProvider = 'google' | 'outlook' | 'calendly';

/**
 * Tipo de compromisso configurável por org. Define duração padrão, buffer
 * entre slots, antecedência mínima e máximo por dia.
 *
 * Tabela: active.appointment_types
 */
export interface AppointmentType {
  id: UUID;
  org_id: UUID;
  name: string;
  description: string | null;
  duration_minutes: number;
  location_type: AppointmentLocationType;
  location_details: string | null;
  /** Hex da cor pro bloco no calendário. Default #00E5FF. */
  color: string;
  /** Folga entre dois compromissos consecutivos. */
  buffer_minutes: number;
  /** Quanto tempo de antecedência mínima pra agendar (default 2h). */
  min_advance_hours: number;
  /** Limite de compromissos do mesmo tipo no dia (anti-spam). */
  max_per_day: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Compromisso individual. Vinculável a contato, deal e conversa.
 *
 * Tabela: active.appointments
 */
export interface Appointment {
  id: UUID;
  org_id: UUID;
  appointment_type_id: UUID | null;
  contact_id: UUID | null;
  deal_id: UUID | null;
  conversation_id: UUID | null;
  /** Membro responsável (org_members.id, NÃO user_id). */
  assigned_to: UUID | null;
  title: string;
  description: string | null;
  start_time: ISODateString;
  end_time: ISODateString;
  location_type: AppointmentLocationType | null;
  location_details: string | null;
  status: AppointmentStatus;
  reminder_sent_24h: boolean;
  reminder_sent_1h: boolean;
  cancelled_reason: string | null;
  /** Quando rescheduled, aponta pro appointment original (cancelled). */
  rescheduled_from: UUID | null;
  external_calendar_id: string | null;
  external_calendar_provider: ExternalCalendarProvider | null;
  notes: string | null;
  created_by_ai: boolean;
  metadata: Record<string, unknown>;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Detalhe expandido — vem com joins de contact / deal / agent / type.
 */
export interface AppointmentDetail extends Appointment {
  contact: { id: UUID; name: string | null; phone: string | null; avatar_url: string | null } | null;
  deal: { id: UUID; title: string; value: number | null; currency: string } | null;
  agent: { id: UUID; display_name: string | null; email: string | null; avatar_url: string | null } | null;
  type: Pick<AppointmentType, 'id' | 'name' | 'color' | 'duration_minutes' | 'location_type'> | null;
}

/**
 * Slot disponível pra agendamento — calculado dinâmicamente em
 * appointments.service.getAvailableSlots.
 */
export interface AvailabilitySlot {
  start_time: ISODateString;
  end_time: ISODateString;
  agent_id: UUID;
  agent_name: string | null;
}

/**
 * Disponibilidade de agente — semanal recorrente OU override por data.
 *
 * Tabela: active.agent_availability
 */
export interface AgentAvailability {
  id: UUID;
  org_id: UUID;
  agent_id: UUID;
  /** 0=domingo .. 6=sábado. Null quando specific_date é setada. */
  day_of_week: number | null;
  start_time: string; // HH:mm:ss
  end_time: string;
  is_available: boolean;
  specific_date: string | null; // YYYY-MM-DD
  created_at: ISODateString;
}

/**
 * Resultado da detecção de intenção de agendamento via Haiku.
 */
export interface SchedulingIntent {
  wants_scheduling: boolean;
  appointment_type_guess: string | null;
  /** YYYY-MM-DD se o cliente mencionou data, senão null. */
  preferred_date: string | null;
  /** HH:mm se mencionou horário, senão null. */
  preferred_time: string | null;
  urgency: 'low' | 'medium' | 'high';
  /** Trecho da mensagem que sinalizou agendamento. */
  extracted_text: string;
}
