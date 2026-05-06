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
    name: 'search_live_sources',
    description:
      'Consulta fontes externas cadastradas (sites, lojas, APIs, RSS) para buscar informações atualizadas em TEMPO REAL. Use quando o usuário precisa de dado fresco que pode mudar (estoque, preço do dia, status atual). NÃO use pra info estável — pra isso, use search_knowledge.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Termo ou pergunta em linguagem natural — quanto mais específico, melhor (ex: "preço atual da camiseta azul").',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'check_available_slots',
    description:
      'Verifica horários disponíveis para agendamento. Use quando o vendedor pergunta "quais horários tenho na quarta?", "qual a próxima data livre pra reunião?", etc.',
    input_schema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Data alvo no formato YYYY-MM-DD. Se omitido, usa amanhã.',
        },
        agent_id: {
          type: 'string',
          description: 'UUID do agente. Se omitido, retorna slots de todos os agentes ativos.',
        },
        type_id: {
          type: 'string',
          description: 'UUID do appointment_type pra usar duração/buffer corretos.',
        },
      },
      required: [],
    },
  },
  {
    name: 'schedule_appointment',
    description:
      'Cria um agendamento (appointment) pra um contato. Use quando o vendedor pedir "agende reunião com João pra terça às 14h", "marca uma ligação amanhã 10h", etc. Cria o appointment direto — não pede confirmação.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título do agendamento (ex: "Reunião — apresentação Vazzo").' },
        contact_id: { type: 'string', description: 'UUID do contato.' },
        deal_id: { type: 'string', description: 'UUID do deal vinculado (opcional).' },
        appointment_type_id: { type: 'string', description: 'UUID do tipo (reunião/ligação/visita).' },
        start_time: {
          type: 'string',
          description: 'ISO 8601 com timezone (ex: 2026-05-12T14:00:00-03:00).',
        },
        duration_minutes: {
          type: 'number',
          description: 'Duração em minutos. Default = duração do tipo (ou 30).',
        },
        notes: { type: 'string', description: 'Observações opcionais sobre o agendamento.' },
      },
      required: ['title', 'start_time'],
    },
  },
  {
    name: 'send_scheduling_link',
    description:
      'Gera o link de agendamento (Calendly) do agente atual para enviar ao cliente. Use quando o vendedor pedir "envia meu link de agendamento", "manda o Calendly". Retorna a URL pra o vendedor copiar/colar.',
    input_schema: {
      type: 'object',
      properties: {
        event_type_uri: {
          type: 'string',
          description: 'URI do event_type específico do Calendly. Se omitido, usa link geral.',
        },
      },
      required: [],
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
  // ── SAC tools ──
  {
    name: 'list_sac_tickets',
    description:
      'Lista tickets do SAC (atendimento pós-venda). Use quando o usuário perguntar sobre tickets, atendimentos, reclamações, atrasos, problemas de entrega ou pedidos com defeito. Filtros: prioridade (low/normal/high/critical/reputation_risk), status (new/in_progress/waiting_customer/waiting_internal/resolved/reopened/cancelled), categoria, SLA vencido. Por padrão lista tickets abertos ordenados por prioridade.',
    input_schema: {
      type: 'object',
      properties: {
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'critical', 'reputation_risk'],
          description: 'Filtra por prioridade. Use "critical" pra urgentes ou "reputation_risk" pra risco de reputação.',
        },
        status: {
          type: 'string',
          enum: ['new', 'in_progress', 'waiting_customer', 'waiting_internal', 'resolved', 'reopened'],
          description: 'Filtra por status. Omita pra ver os abertos.',
        },
        category: {
          type: 'string',
          enum: [
            'pre_sale', 'post_sale', 'order_status', 'delivery_delay',
            'exchange', 'return', 'warranty', 'cancellation', 'refund',
            'defective_product', 'wrong_product', 'missing_parts',
            'invoice', 'payment', 'technical', 'complaint', 'mediation',
            'negative_review', 'general',
          ],
        },
        sla_breached: {
          type: 'boolean',
          description: 'Se true, só tickets com SLA vencido.',
        },
        limit: { type: 'number', description: 'Default 10, máx 25.' },
      },
      required: [],
    },
  },
  {
    name: 'get_sac_dashboard',
    description:
      'Retorna o snapshot atual do SAC: contagem de tickets por status, críticos abertos, SLA vencendo em <1h, SLA já vencidos, risco reputacional, resolvidos hoje. Use quando o usuário pedir "resumo do SAC", "como tá o atendimento", "tickets críticos" sem mais contexto.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_sac_performance',
    description:
      'Roda diagnóstico IA do SAC com base nas métricas do período: identifica problemas principais, produtos com mais reclamações, canais problemáticos e gera recomendações. Use quando o usuário pedir análise de performance, diagnóstico do SAC, "como melhorar atendimento", "produtos problemáticos".',
    input_schema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['today', 'week', 'month'],
          description: 'Janela temporal — default "week".',
        },
      },
      required: [],
    },
  },
  {
    name: 'check_order_status',
    description:
      'Consulta o status de um pedido do SaaS via bridge. Aceita número do pedido (marketplace_order_id), código de rastreio ou UUID. Retorna marketplace, status logístico, rastreio, valor, prazo de entrega. Use quando o usuário perguntar status de pedido específico ou consultar pra um cliente.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Número do pedido, rastreio ou UUID.',
        },
      },
      required: ['query'],
    },
  },
  // ── Social AI Studio tools ──
  {
    name: 'generate_social_content',
    description:
      'Cria + gera conteúdo de Instagram (post estático ou carrossel) com IA. Use quando o usuário pedir "cria um post sobre X", "faz carrossel disso", "gera conteúdo de Y". Retorna ID do conteúdo criado pra usuário aprovar depois.',
    input_schema: {
      type: 'object',
      properties: {
        brand_id: {
          type: 'string',
          description: 'UUID da marca (omita pra usar a primeira ativa).',
        },
        type: {
          type: 'string',
          enum: ['post', 'carousel'],
          description: 'Tipo de conteúdo. Default post.',
        },
        theme: {
          type: 'string',
          description: 'Tema/brief do conteúdo. Obrigatório.',
        },
        pillar: {
          type: 'string',
          enum: [
            'educational', 'promotional', 'social_proof', 'entertainment',
            'institutional', 'engagement', 'product', 'behind_scenes',
          ],
          description: 'Pilar editorial. Default educational.',
        },
        slide_count: {
          type: 'number',
          description: 'Apenas pra carrossel. Default 7. Range 3-10.',
        },
      },
      required: ['theme'],
    },
  },
  {
    name: 'list_pending_social_content',
    description:
      'Lista conteúdos de Social AI aguardando aprovação. Use quando o usuário perguntar "o que tá pendente pra aprovar?", "tem post novo da IA?", "ver conteúdos novos".',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Default 10, máx 25.' },
      },
      required: [],
    },
  },
  {
    name: 'get_social_dashboard',
    description:
      'Retorna métricas atuais do Social AI Studio: contagem de pendentes aprovação, agendados próximos 7 dias, rascunhos, publicados no mês, distribuição por pilar. Use pra "como tá o conteúdo?", "resumo do social".',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'schedule_social_content',
    description:
      'Agenda conteúdo aprovado pra publicação manual. Use quando o usuário disser "agenda o post X pra amanhã 14h", "marca o conteúdo Y pra terça". Aceita ISO datetime ou formato relativo.',
    input_schema: {
      type: 'object',
      properties: {
        content_id: { type: 'string', description: 'UUID do conteúdo.' },
        scheduled_for: {
          type: 'string',
          description: 'ISO datetime (ex: 2026-05-10T14:00:00-03:00).',
        },
      },
      required: ['content_id', 'scheduled_for'],
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
  | 'search_knowledge'
  | 'search_live_sources'
  | 'check_available_slots'
  | 'schedule_appointment'
  | 'list_sac_tickets'
  | 'get_sac_dashboard'
  | 'get_sac_performance'
  | 'check_order_status'
  | 'send_scheduling_link'
  | 'generate_social_content'
  | 'list_pending_social_content'
  | 'get_social_dashboard'
  | 'schedule_social_content';
