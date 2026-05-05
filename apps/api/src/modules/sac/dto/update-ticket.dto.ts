import type {
  SacCategory,
  SacPriority,
  SacStatus,
  SacDepartment,
  SacReputationRisk,
} from '../sac.types';

export interface UpdateTicketDto {
  status?: SacStatus;
  priority?: SacPriority;
  category?: SacCategory;
  subcategory?: string | null;
  department?: SacDepartment | null;
  assigned_to?: string | null;
  reputation_risk_level?: SacReputationRisk;
  tags?: string[];
}

export interface AssignTicketDto {
  agent_id: string;
}

export interface EscalateTicketDto {
  to_agent_id: string;
  reason?: string;
}
