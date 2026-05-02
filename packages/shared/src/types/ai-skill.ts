import type { ISODateString, UUID } from './common';

export type AiSkillType = 'system' | 'custom';

export type AiSkillAction =
  | 'send_message'
  | 'create_task'
  | 'create_deal'
  | 'move_deal'
  | 'update_contact'
  | 'assign_conversation'
  | 'search_knowledge';

export interface AiSkillTriggerConditions {
  /** AIIntent values: budget, question, complaint, negotiation, support, scheduling, greeting, farewell */
  intents?: string[];
  /** ai temperature: cold, warm, hot, very_hot */
  temperatures?: string[];
  /** sentiment: very_positive, positive, neutral, negative, very_negative */
  sentiments?: string[];
  /** Frases configuradas pelo admin — match semântico (ou substring fallback) */
  custom_phrases?: string[];
  /** Embeddings das custom_phrases — populadas ao criar/atualizar */
  phrase_embeddings?: Array<{ phrase: string; embedding: number[] }>;
}

export interface AiSkill {
  id: UUID;
  org_id: UUID;
  name: string;
  description: string;
  skill_type: AiSkillType;
  system_prompt: string;
  knowledge_source_ids: UUID[];
  knowledge_categories: string[];
  allowed_actions: AiSkillAction[];
  trigger_conditions: AiSkillTriggerConditions;
  priority: number;
  is_active: boolean;
  execution_count: number;
  avg_confidence: number;
  created_by: UUID | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface AiAgentSkill {
  id: UUID;
  persona_id: UUID;
  skill_id: UUID;
  priority: number;
  is_active: boolean;
  created_at: ISODateString;
}

// ──────────────────────────────────────────────────────────
// Persona routing rules (jsonb)
// ──────────────────────────────────────────────────────────

export interface PersonaRoutingRules {
  /** Canais onde este agente atua. Vazio = qualquer canal */
  channels?: string[];
  /** Stages onde este agente atua (UUIDs de pipeline_stages). Vazio = qualquer stage */
  stages?: UUID[];
  /** Intents que ativam este agente. Vazio = qualquer intent */
  intents?: string[];
  /** 'business_only' | 'after_hours' | 'always' */
  hours?: 'business_only' | 'after_hours' | 'always';
}
