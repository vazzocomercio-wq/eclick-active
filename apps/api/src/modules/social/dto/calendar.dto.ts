import type { CalendarObjective, CalendarStatus } from '../social.types';

export interface GenerateCalendarDto {
  brand_id: string;
  start_date: string;
  duration_days: 7 | 15 | 30;
  channels: string[];
  objective: CalendarObjective;
  frequency_per_week: number;
  content_mix?: Record<string, number>;
  special_dates?: Array<{ date: string; theme: string }>;
  campaigns?: Array<{ name: string; start: string; end: string }>;
}

export interface CreateCalendarDto {
  brand_id: string;
  name: string;
  start_date: string;
  end_date: string;
  channels?: string[];
  objective?: CalendarObjective;
  frequency_per_week?: number;
  content_mix?: Record<string, number>;
}

export type UpdateCalendarDto = Partial<CreateCalendarDto> & { status?: CalendarStatus };
