import type { Json, UUID, ISODateString } from './common';
import type { TaskType, TaskPriority, TaskStatus } from '../enums';

/**
 * Tarefa atribuída a um agente. Pode ser criada por humano ou pela IA.
 * Tabela: active.tasks
 */
export interface Task {
  id: UUID;
  org_id: UUID;
  title: string;
  description: string | null;
  task_type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  // Vínculos
  deal_id: UUID | null;
  contact_id: UUID | null;
  conversation_id: UUID | null;
  // Atribuição
  assigned_to: UUID;
  // Datas
  due_date: ISODateString | null;
  completed_at: ISODateString | null;
  // IA
  /** true se a IA criou esta tarefa */
  created_by_ai: boolean;
  /** Justificativa de por que a IA criou — ex: "contato sem resposta há 5 dias" */
  ai_context: string | null;
  metadata: Json;
  /** null se foi criada pela IA / sistema */
  created_by: UUID | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}
