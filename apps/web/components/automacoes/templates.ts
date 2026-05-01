import type { AutomationTriggerType } from '@eclick-active/shared';
import type {
  AutomationAction,
  CreateAutomationInput,
} from '@/lib/api/automations';

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  example: string;
  build: () => CreateAutomationInput;
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'first-contact',
    name: 'Primeiro atendimento',
    description: 'Saudação automática + tarefa de follow-up em 2h',
    example: 'Cliente novo manda mensagem → manda saudação + lembra você 2h depois',
    build: () => ({
      name: 'Primeiro atendimento',
      description:
        'Cliente envia primeira mensagem: responde com saudação e cria tarefa pra dar follow-up',
      trigger_type: 'message_received' as AutomationTriggerType,
      trigger_config: {},
      actions: [
        {
          type: 'send_message',
          text: 'Olá {{contact.first_name}}! Tudo bem? Recebemos sua mensagem e vamos te responder o mais rápido possível.',
        },
        {
          type: 'create_task',
          title: 'Follow-up — primeira resposta',
          task_type: 'follow_up',
          due_in_hours: 2,
          priority: 'high',
        },
      ] satisfies AutomationAction[],
      is_active: false,
    }),
  },
  {
    id: 'post-proposal',
    name: 'Follow-up pós-proposta',
    description: 'Aguarda 24h após proposta enviada → mensagem de retomada',
    example: 'Deal entra em "Proposta Enviada" → 24h depois manda follow-up',
    build: () => ({
      name: 'Follow-up pós-proposta',
      description:
        'Quando o deal entra na etapa "Proposta Enviada", aguarda 24h e dispara follow-up',
      trigger_type: 'deal_stage_changed' as AutomationTriggerType,
      // O usuário precisa preencher to_stage_id antes de ativar
      trigger_config: {},
      actions: [
        { type: 'wait', minutes: 5 }, // 5min p/ teste — ajustar pra 24h em prod
        {
          type: 'send_message',
          text: 'Olá {{contact.first_name}}, tudo certo? Passei pra saber se conseguiu analisar a proposta. Posso esclarecer alguma dúvida?',
        },
      ] satisfies AutomationAction[],
      is_active: false,
    }),
  },
  {
    id: 'cold-revival',
    name: 'Reativação de leads frios',
    description: 'Manual → tag "reativacao" + mensagem de retomada',
    example: 'Você dispara manualmente → marca contato e manda mensagem',
    build: () => ({
      name: 'Reativação de leads frios',
      description:
        'Disparada manualmente para retomar contato com leads sem interação recente',
      trigger_type: 'manual' as AutomationTriggerType,
      trigger_config: {},
      actions: [
        {
          type: 'update_contact',
          add_tags: ['reativacao'],
        },
        {
          type: 'send_message',
          text: 'Olá {{contact.first_name}}, faz um tempo que não conversamos. Como posso te ajudar agora?',
        },
      ] satisfies AutomationAction[],
      is_active: false,
    }),
  },
];
