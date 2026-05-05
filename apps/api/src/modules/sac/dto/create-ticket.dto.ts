import type {
  SacCategory,
  SacPriority,
  SacDepartment,
} from '../sac.types';

export interface CreateTicketDto {
  contact_id: string;
  conversation_id?: string | null;
  category?: SacCategory;
  subcategory?: string;
  priority?: SacPriority;
  department?: SacDepartment;
  source_channel?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}
