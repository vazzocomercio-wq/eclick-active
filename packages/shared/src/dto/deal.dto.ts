import type { UUID, ISODateOnly } from '../types/common';

/** Payload de criação de Deal (POST /deals) */
export interface CreateDealDto {
  pipeline_id: UUID;
  stage_id: UUID;
  title: string;
  contact_id?: UUID;
  company_id?: UUID;
  conversation_id?: UUID;
  value?: number;
  currency?: string;
  expected_close_date?: ISODateOnly;
  assigned_to?: UUID;
  tags?: string[];
  custom_fields?: Record<string, unknown>;
}

/** Atualização parcial de Deal (PATCH /deals/:id) */
export type UpdateDealDto = Partial<Omit<CreateDealDto, 'pipeline_id'>>;

/** Mover deal entre estágios (PATCH /deals/:id/move) */
export interface MoveDealDto {
  stage_id: UUID;
  /** Posição vertical dentro do estágio (drag-and-drop). 0 = topo */
  position: number;
}

/** Marcar deal como ganho (POST /deals/:id/win) */
export interface WinDealDto {
  /** Estágio "Ganho" do pipeline (deve ter is_won=true) */
  stage_id?: UUID;
  /** Valor final fechado, se diferente do `value` original */
  final_value?: number;
}

/** Marcar deal como perdido (POST /deals/:id/lose) */
export interface LoseDealDto {
  stage_id?: UUID;
  /** Motivo livre — usado em analytics de "lost reasons" */
  lost_reason: string;
}
