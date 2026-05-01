import type Anthropic from '@anthropic-ai/sdk';

/**
 * Tool definitions enviadas ao Claude. Os schemas seguem o padrão da API
 * Anthropic: type=object, properties, required, additionalProperties.
 *
 * Importante: descrições concisas e PT-BR (o modelo vai usar isso para
 * decidir qual tool chamar). Os names são em inglês_snake (convenção SDK).
 */

export const COPILOT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_contacts',
    description:
      'Busca contatos do CRM por nome, telefone ou email. Use quando o usuário perguntar sobre leads, contatos ou pessoas específicas. Suporta filtro por temperatura (cold/warm/hot/very_hot).',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Termo de busca livre (nome, telefone, email). Use string vazia para listar sem filtro.',
        },
        temperature: {
          type: 'string',
          enum: ['cold', 'warm', 'hot', 'very_hot'],
          description: 'Filtra por temperatura. Omita para todas.',
        },
        limit: {
          type: 'number',
          description: 'Máximo de resultados (default 10, máx 25).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_deals',
    description:
      'Lista negócios (deals) do funil. Use para responder sobre pipeline, oportunidades, valores e probabilidades. Aceita filtros por pipeline, stage, responsável, range de valor e fechados.',
    input_schema: {
      type: 'object',
      properties: {
        pipeline_id: { type: 'string', description: 'UUID do pipeline (omita para todos).' },
        stage_id: { type: 'string', description: 'UUID do stage.' },
        assigned_to: { type: 'string', description: 'UUID do agente.' },
        min_value: { type: 'number' },
        max_value: { type: 'number' },
        only_at_risk: {
          type: 'boolean',
          description: 'Se true, só deals com ai_risk high/critical.',
        },
        limit: { type: 'number', description: 'Máximo de resultados (default 10, máx 25).' },
      },
      required: [],
    },
  },
  {
    name: 'get_pipeline_summary',
    description:
      'Retorna métricas agregadas do funil: total_deals, total_value, weighted_value e contagem/valor por stage. Use quando o usuário pedir resumo do funil ou diagnóstico de pipeline.',
    input_schema: {
      type: 'object',
      properties: {
        pipeline_id: {
          type: 'string',
          description:
            'UUID do pipeline. Se omitido, usa o primeiro pipeline ativo da org.',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_conversations',
    description:
      'Lista conversas recentes (WhatsApp, email, etc). Use para responder sobre mensagens não respondidas, conversas em aberto ou contatos ativos. Aceita filtros por status, prioridade e canal.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'pending', 'snoozed', 'resolved', 'closed'],
        },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        only_unanswered: {
          type: 'boolean',
          description: 'Se true, só conversas com unread_count > 0.',
        },
        limit: { type: 'number', description: 'Default 10, máx 25.' },
      },
      required: [],
    },
  },
  {
    name: 'list_tasks',
    description:
      'Lista tarefas do CRM. Use para responder sobre o que o vendedor tem pra fazer, follow-ups pendentes ou tarefas atrasadas. Por padrão lista as do próprio usuário.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled', 'overdue'],
        },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        only_overdue: {
          type: 'boolean',
          description: 'Se true, só tarefas overdue (pending/in_progress com due_date < now).',
        },
        only_today: {
          type: 'boolean',
          description: 'Se true, só tarefas com due_date no dia de hoje.',
        },
        mine_only: {
          type: 'boolean',
          description: 'Se true (default), só tarefas atribuídas ao usuário atual.',
        },
        limit: { type: 'number', description: 'Default 15, máx 30.' },
      },
      required: [],
    },
  },
  {
    name: 'get_agent_stats',
    description:
      'Retorna métricas de performance do vendedor (deals ganhos/perdidos, valor fechado, taxa de conversão, tarefas concluídas) em um período. Use para responder sobre performance pessoal ou da equipe.',
    input_schema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'UUID do usuário. Se omitido, usa o usuário atual.',
        },
        period_days: {
          type: 'number',
          description:
            'Janela em dias (7=semana, 30=mês). Default 30.',
        },
      },
      required: [],
    },
  },
  {
    name: 'create_task',
    description:
      'Cria uma nova tarefa no CRM atribuída ao usuário atual. Use quando o usuário pedir para criar follow-up, lembrete ou ação.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título da tarefa.' },
        task_type: {
          type: 'string',
          enum: ['call', 'email', 'meeting', 'follow_up', 'whatsapp', 'proposal', 'custom'],
          description: 'Default follow_up.',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Default normal.',
        },
        contact_id: {
          type: 'string',
          description: 'UUID do contato relacionado.',
        },
        deal_id: {
          type: 'string',
          description: 'UUID do deal relacionado.',
        },
        due_date: {
          type: 'string',
          description: 'ISO 8601 (ex: 2026-05-02T15:00:00Z). Omita para sem prazo.',
        },
        description: { type: 'string', description: 'Descrição opcional.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'search_knowledge',
    description:
      'Busca semântica na base de conhecimento da empresa (produtos, preços, políticas, FAQ, scripts de venda, objeções, procedimentos). Use SEMPRE que precisar de informação sobre como a empresa opera, o que vende, ou como responder a perguntas específicas do cliente.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Termo ou pergunta em linguagem natural (português). Quanto mais específico, melhor.',
        },
        limit: {
          type: 'number',
          description: 'Máximo de documentos retornados (default 5, máx 10).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_deal',
    description:
      'Cria um novo negócio (deal) no funil. Use quando o usuário pedir para criar oportunidade ou registrar venda em andamento.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        contact_id: { type: 'string', description: 'UUID do contato (recomendado).' },
        pipeline_id: {
          type: 'string',
          description: 'UUID do pipeline. Se omitido, usa o primeiro pipeline ativo.',
        },
        value: { type: 'number', description: 'Valor em BRL (positivo).' },
      },
      required: ['title'],
    },
  },
];

export type CopilotToolName =
  | 'search_contacts'
  | 'list_deals'
  | 'get_pipeline_summary'
  | 'list_conversations'
  | 'list_tasks'
  | 'get_agent_stats'
  | 'create_task'
  | 'create_deal'
  | 'search_knowledge';
