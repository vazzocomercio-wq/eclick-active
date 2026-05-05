import type { SacResolutionType } from '../sac.types';

export interface ResolveTicketDto {
  resolution_type: SacResolutionType;
  resolution_notes?: string;
}

export interface ReopenTicketDto {
  reason?: string;
}

export interface RateTicketDto {
  rating: 1 | 2 | 3 | 4 | 5;
}

export interface AddNoteDto {
  content: string;
}

export interface LinkOrderDto {
  query: string;
}
