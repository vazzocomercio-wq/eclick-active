import type { Json, UUID, ISODateString, ISODateOnly } from './common';
import type { DealRisk, DealActivityType } from '../enums';

/**
 * Funil de vendas. Uma org pode ter múltiplos pipelines (ex: B2B, B2C).
 * Tabela: active.pipelines
 */
export interface Pipeline {
  id: UUID;
  org_id: UUID;
  workspace_id: UUID | null;
  name: string;
  /**
   * Descrição livre do pipeline (texto). Usada pela IA do AI Concierge
   * pra rotear leads inteligentemente entre os pipelines da org. Migration 028.
   */
  description: string | null;
  is_default: boolean;
  settings: Json;
  /**
   * Quando setado, o pipeline está arquivado: não aparece no board nem
   * no selector, mas dados ficam preservados pra relatórios. Migration 010.
   */
  archived_at: ISODateString | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Estágio dentro de um pipeline (ex: "Novo Lead", "Qualificado", "Ganho").
 * Tabela: active.pipeline_stages
 */
export interface PipelineStage {
  id: UUID;
  pipeline_id: UUID;
  name: string;
  /**
   * Descrição livre do stage (texto). Usada pela IA do AI Concierge pra
   * escolher onde encaixar o lead. Migration 028.
   */
  description: string | null;
  /** Ordem visual no Kanban (0-indexed) */
  position: number;
  /** Hex color (ex: "#00E5FF") usado no Kanban */
  color: string;
  /** Probabilidade de fechamento (0–100), usada em forecasting */
  probability: number;
  /** SLA — máximo de horas que um deal deveria ficar nesse estágio */
  sla_hours: number | null;
  /** Regras de automação aplicadas ao entrar nesse estágio */
  automation_rules: Json;
  is_won: boolean;
  is_lost: boolean;
  /**
   * Bloco G: campos do CONTATO que precisam estar preenchidos quando o
   * deal está nesse stage. Valores: chaves padrão ('name', 'email',
   * 'phone', 'company_name') ou 'custom:<uuid>' pra custom fields.
   */
  required_contact_fields: string[];
  /** Idem para campos do DEAL (ex: 'value', 'expected_close_date', 'custom:<uuid>') */
  required_deal_fields: string[];
  created_at: ISODateString;
}

/**
 * Negócio/oportunidade no funil. Vinculado a contato + estágio.
 * Tabela: active.deals
 */
export interface Deal {
  id: UUID;
  org_id: UUID;
  pipeline_id: UUID;
  stage_id: UUID;
  contact_id: UUID | null;
  company_id: UUID | null;
  conversation_id: UUID | null;
  /**
   * Número sequencial dentro da org (ex: 142). Gerado por trigger SQL
   * BEFORE INSERT — atómico via leitura+max+inc no mesmo statement. Usado
   * na UI ("Negócio #142") e em referências do Copiloto. Migration 009.
   */
  deal_number: number;
  // Info do deal
  title: string;
  value: number;
  /** ISO 4217 (BRL, USD, EUR) */
  currency: string;
  expected_close_date: ISODateOnly | null;
  // Atribuição
  assigned_to: UUID | null;
  // Campos gerados por IA
  /** Score 0–100 baseado em sinais de engajamento, fit, intenção */
  ai_score: number;
  ai_risk: DealRisk | null;
  /** Próxima ação sugerida pela IA (texto livre, atualizado periodicamente) */
  ai_next_action: string | null;
  /** Probabilidade 0–100 de fechamento, calculada pela IA */
  ai_close_probability: number | null;
  // Resultado
  won_at: ISODateString | null;
  lost_at: ISODateString | null;
  lost_reason: string | null;
  // Metadata
  tags: string[];
  custom_fields: Record<string, unknown>;
  /** Posição vertical dentro do estágio no Kanban (drag-and-drop) */
  position: number;
  /** Setado automaticamente via trigger quando stage_id muda */
  stage_entered_at: ISODateString;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Atividade registrada num deal (mudança de etapa, anotação, ligação, etc).
 * Tabela: active.deal_activities
 */
export interface DealActivity {
  id: UUID;
  org_id: UUID;
  deal_id: UUID;
  activity_type: DealActivityType;
  title: string | null;
  description: string | null;
  /** Shape varia por activity_type — ex: stage_changed: { from, to } */
  metadata: Json;
  /** null = sistema/IA */
  created_by: UUID | null;
  created_at: ISODateString;
}
