import type { ISODateString, UUID } from './common';

export type AiPersonaRole =
  | 'sales_assistant'
  | 'support_agent'
  | 'receptionist'
  | 'custom';

export type AiPersonaTone = 'formal' | 'semiformal' | 'casual' | 'friendly';

export type AiPersonaResponseLength = 'short' | 'medium' | 'detailed';

/**
 * Configuração extra da persona (jsonb). Campos são opcionais — defaults
 * aplicados no service.
 */
export interface AiPersonaSettings {
  /** Se true, IA responde automaticamente fora do horário comercial */
  auto_respond_outside_hours?: boolean;
  /** Se true, IA tenta coletar nome/email/dados que faltarem do contato */
  collect_missing_data?: boolean;
  /** Se true, cria tarefa de follow-up pro próximo dia útil após resposta automática */
  create_followup_task?: boolean;
  /** Se true, gera briefing matinal das conversas noturnas */
  morning_briefing_enabled?: boolean;
  /** Limite de respostas automáticas por conversa (evita loops) */
  max_auto_responses_per_conversation?: number;
  /** Confiança mínima (0..1) pra IA disparar resposta automática */
  confidence_threshold?: number;
}

export interface AiAgentPersona {
  id: UUID;
  org_id: UUID;
  name: string;
  avatar_url: string | null;
  role: AiPersonaRole;
  personality: string | null;
  tone: AiPersonaTone;
  response_length: AiPersonaResponseLength;
  language: string;
  response_delay_seconds: number;
  guidelines: string[];
  forbidden_topics: string[];
  greeting_message: string | null;
  fallback_message: string | null;
  is_default: boolean;
  is_active: boolean;
  /** Stored as jsonb — extends `AiPersonaSettings` with arbitrary keys */
  settings: AiPersonaSettings & Record<string, unknown>;
  created_at: ISODateString;
  updated_at: ISODateString;
}

// ──────────────────────────────────────────────────────────
// Business hours (organizations.business_hours jsonb)
// ──────────────────────────────────────────────────────────

export interface BusinessHoursDayConfig {
  /** Hora início HH:mm (omitido quando enabled=false) */
  start?: string;
  /** Hora fim HH:mm */
  end?: string;
  enabled: boolean;
}

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface BusinessHoursConfig {
  enabled: boolean;
  /** IANA tz (ex: "America/Sao_Paulo"). Default = "America/Sao_Paulo" */
  timezone: string;
  schedule: Record<WeekdayKey, BusinessHoursDayConfig>;
}

// ──────────────────────────────────────────────────────────
// AI test sandbox
// ──────────────────────────────────────────────────────────

export interface AiTestMessage {
  /** 'user' = admin simulando cliente. 'assistant' = persona respondendo. */
  role: 'user' | 'assistant';
  content: string;
  timestamp: ISODateString;
  /** Metadata só pro role='assistant' — intent, sentiment, sources, etc. */
  ai_metadata?: AiTestResponseMetadata;
}

export interface AiTestResponseMetadata {
  intent_detected?: string;
  sentiment?: string;
  temperature?: string;
  /** 0..1 */
  confidence?: number;
  knowledge_sources_used?: Array<{ id: UUID; title: string; category: string }>;
  /** Ações que a IA tomaria caso não fosse modo teste (ex: "Criaria tarefa X") */
  actions_would_take?: string[];
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  latency_ms?: number;
}

export interface AiTestConversation {
  id: UUID;
  org_id: UUID;
  persona_id: UUID | null;
  user_id: UUID;
  messages: AiTestMessage[];
  created_at: ISODateString;
  updated_at: ISODateString;
  expires_at: ISODateString;
}
