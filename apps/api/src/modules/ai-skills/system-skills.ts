import type { AiSkillAction, AiSkillTriggerConditions } from '@eclick-active/shared';

/**
 * Skills do sistema — criados automaticamente pra cada org via
 * `seedSystemSkills()`. Não podem ser deletados (apenas desativados).
 *
 * Cada skill tem um system_prompt especializado, ações permitidas e
 * condições de ativação. O routing decide qual skill usar pra cada msg.
 */

export interface SystemSkillSeed {
  name: string;
  description: string;
  system_prompt: string;
  allowed_actions: AiSkillAction[];
  trigger_conditions: AiSkillTriggerConditions;
  knowledge_categories: string[];
  priority: number;
}

export const SYSTEM_SKILLS: SystemSkillSeed[] = [
  {
    name: 'qualificar_lead',
    description:
      'Qualifica leads identificando interesse, coletando dados de contato e classificando temperatura',
    system_prompt:
      'Você está qualificando um novo lead. Seu objetivo é: 1) Entender o que o cliente precisa. 2) Coletar nome, email e telefone de forma natural na conversa. 3) Classificar a urgência e intenção de compra. Seja proativo mas não invasivo. Não peça todos os dados de uma vez — colete naturalmente ao longo da conversa.',
    allowed_actions: ['update_contact', 'create_task', 'search_knowledge'],
    trigger_conditions: { intents: ['greeting', 'question', 'budget'] },
    knowledge_categories: ['products', 'pricing', 'faq'],
    priority: 50,
  },
  {
    name: 'responder_duvidas',
    description:
      'Responde dúvidas sobre produtos, serviços, preços e políticas usando a base de conhecimento',
    system_prompt:
      'Responda a dúvida do cliente usando SOMENTE informações da base de conhecimento fornecida. Se a informação não estiver disponível, diga que vai verificar e transferir para um especialista. NUNCA invente preços, prazos ou condições.',
    allowed_actions: ['send_message', 'search_knowledge'],
    trigger_conditions: { intents: ['question', 'support'] },
    knowledge_categories: ['products', 'pricing', 'policies', 'faq'],
    priority: 60,
  },
  {
    name: 'agendar_reuniao',
    description:
      'Detecta intenção de agendamento e conduz o processo de marcação de reunião',
    system_prompt:
      'O cliente quer agendar uma reunião ou visita. Pergunte: 1) Qual o melhor dia e horário. 2) Se prefere presencial ou online. 3) Confirme os dados. Crie uma tarefa de reunião com os detalhes. Seja objetivo e eficiente.',
    allowed_actions: ['create_task', 'update_contact', 'send_message'],
    trigger_conditions: {
      custom_phrases: [
        'agendar',
        'marcar horário',
        'visita',
        'reunião',
        'disponibilidade',
      ],
    },
    knowledge_categories: [],
    priority: 70,
  },
  {
    name: 'enviar_proposta',
    description:
      'Prepara e conduz o envio de proposta comercial baseado nos produtos/serviços da empresa',
    system_prompt:
      'O cliente está pronto para receber uma proposta. Use a base de conhecimento para montar uma proposta com: produtos/serviços relevantes, preços, condições de pagamento, prazo. Pergunte detalhes que faltam antes de enviar. Crie uma tarefa de follow-up para 48h após envio.',
    allowed_actions: ['send_message', 'create_task', 'move_deal', 'search_knowledge'],
    trigger_conditions: {
      intents: ['budget', 'negotiation'],
      temperatures: ['hot', 'very_hot'],
    },
    knowledge_categories: ['products', 'pricing', 'policies'],
    priority: 80,
  },
  {
    name: 'follow_up',
    description: 'Reengaja leads frios ou sem resposta com abordagem personalizada',
    system_prompt:
      'Este lead está sem interação há algum tempo. Seu objetivo é reengajar de forma natural. Use o histórico da conversa para personalizar: mencione o que o cliente demonstrou interesse, ofereça novidade ou condição especial. NÃO seja genérico. 1 mensagem, máximo 3 frases.',
    allowed_actions: ['send_message', 'update_contact', 'create_task'],
    trigger_conditions: { temperatures: ['cold', 'warm'] },
    knowledge_categories: ['products'],
    priority: 30,
  },
  {
    name: 'resolver_reclamacao',
    description:
      'Lida com clientes insatisfeitos ou reclamações com empatia e foco em resolução',
    system_prompt:
      'O cliente está insatisfeito ou reclamando. REGRAS: 1) Demonstre empatia genuína primeiro. 2) NÃO justifique ou discuta. 3) Pergunte detalhes do problema. 4) Ofereça solução concreta quando possível. 5) Se não puder resolver, TRANSFIRA para humano imediatamente com contexto completo. Tom: empático, calmo, resolutivo.',
    allowed_actions: ['send_message', 'create_task', 'assign_conversation', 'search_knowledge'],
    trigger_conditions: {
      intents: ['complaint'],
      sentiments: ['negative', 'very_negative'],
    },
    knowledge_categories: ['policies', 'faq'],
    priority: 90,
  },
  {
    name: 'coletar_feedback',
    description: 'Conduz pesquisa de satisfação pós-venda de forma natural',
    system_prompt:
      'O objetivo é coletar feedback do cliente sobre a experiência de compra. Pergunte: 1) Como foi a experiência geral (nota 1-10). 2) O que poderia ser melhor. 3) Se recomendaria para um amigo. Seja breve e natural. Agradeça ao final.',
    allowed_actions: ['send_message', 'update_contact', 'create_task'],
    trigger_conditions: {
      custom_phrases: ['feedback', 'satisfação', 'avaliação'],
    },
    knowledge_categories: [],
    priority: 20,
  },
  {
    name: 'cross_sell',
    description:
      'Detecta oportunidades de venda adicional baseado no histórico e perfil do cliente',
    system_prompt:
      'Baseado no que o cliente já comprou ou demonstrou interesse, sugira produtos/serviços complementares. Seja sutil — não force a venda. Mencione benefícios específicos para o caso dele. Se o cliente demonstrar interesse, crie um novo deal.',
    allowed_actions: ['send_message', 'create_deal', 'search_knowledge'],
    trigger_conditions: {
      intents: ['budget'],
      temperatures: ['hot', 'very_hot'],
    },
    knowledge_categories: ['products', 'pricing'],
    priority: 40,
  },
];
