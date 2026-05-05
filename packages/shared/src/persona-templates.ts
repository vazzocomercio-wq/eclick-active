import type { AiPersonaRole, AiPersonaTone } from './types/ai-persona';
import type {
  AppointmentCustomField,
  AppointmentLocationType,
} from './types/appointment';

/**
 * Template de onboarding pra um nicho específico. Cada template traz:
 *   - persona (nome, role, tom, personalidade, guidelines, etc.)
 *   - business_context (vai pro Concierge)
 *   - suggested_specialties (texto livre pros membros configurarem)
 *   - suggested_appointment_types (com custom_fields_schema preenchido)
 *
 * Aplicar um template substitui os fields da persona default da org +
 * mergeia ai_concierge.business_context. Specialties e appointment_types
 * são apenas sugestão — usuário aceita/edita ao aplicar.
 */
export interface PersonaTemplate {
  id: string;
  name: string;
  description: string;
  /** Emoji curto (1-2 chars) pra exibir no card. */
  emoji: string;
  persona: {
    name: string;
    role: AiPersonaRole;
    tone: AiPersonaTone;
    personality: string;
    guidelines: string[];
    forbidden_topics: string[];
    greeting_message: string;
    fallback_message: string;
  };
  business_context: string;
  suggested_specialties: string[];
  suggested_appointment_types: Array<{
    name: string;
    description: string;
    duration_minutes: number;
    buffer_minutes: number;
    location_type: AppointmentLocationType;
    color: string;
    custom_fields_schema: AppointmentCustomField[];
  }>;
}

export const PERSONA_TEMPLATES: PersonaTemplate[] = [
  {
    id: 'clinica_saude',
    name: 'Clínica de saúde',
    description:
      'Consultas, exames, tratamentos. Coleta convênio, especialidade e urgência.',
    emoji: '🏥',
    persona: {
      name: 'Helena',
      role: 'receptionist',
      tone: 'friendly',
      personality:
        'Receptiva, empática e profissional. Conduz o paciente com atenção, sem pressa, validando o que ele compartilha. Passa segurança e confiança.',
      guidelines: [
        'Sempre identifique se é primeira consulta ou paciente recorrente',
        'Pergunte se será atendimento por convênio (qual?) ou particular',
        'Identifique a especialidade ou tipo de tratamento desejado',
        'Avalie se há urgência (sintoma agudo, dor) ou é eletivo',
        'NUNCA dê orientação médica ou sugira diagnósticos — só coleta',
      ],
      forbidden_topics: [
        'diagnóstico médico',
        'prescrição de medicação',
        'tratamentos não autorizados pela clínica',
      ],
      greeting_message:
        'Olá{{contact.first_name}}! Sou a Helena, da clínica. Em que posso te ajudar hoje?',
      fallback_message:
        'Vou pedir pra um atendente humano continuar daqui. Em instantes alguém te responde!',
    },
    business_context:
      'Clínica de saúde com múltiplas especialidades. Atende particular e convênios principais. Foco em acolhimento humanizado.',
    suggested_specialties: [
      'clínico geral',
      'cardiologia',
      'dermatologia',
      'ginecologia',
      'pediatria',
      'ortopedia',
      'nutrição',
    ],
    suggested_appointment_types: [
      {
        name: 'Primeira consulta',
        description: 'Avaliação inicial com novo paciente',
        duration_minutes: 60,
        buffer_minutes: 15,
        location_type: 'presencial',
        color: '#00E5FF',
        custom_fields_schema: [
          {
            key: 'queixa_principal',
            label: 'Queixa principal / motivo da consulta',
            type: 'textarea',
            required: true,
            max_length: 500,
          },
          {
            key: 'convenio',
            label: 'Tipo de atendimento',
            type: 'select',
            required: true,
            options: ['Particular', 'Unimed', 'Bradesco Saúde', 'Amil', 'SulAmérica', 'Outros'],
          },
          {
            key: 'urgencia',
            label: 'Nível de urgência',
            type: 'select',
            required: false,
            options: ['Eletivo', 'Moderado', 'Urgente'],
          },
        ],
      },
      {
        name: 'Retorno',
        description: 'Consulta de acompanhamento',
        duration_minutes: 30,
        buffer_minutes: 10,
        location_type: 'presencial',
        color: '#10B981',
        custom_fields_schema: [
          {
            key: 'evolucao',
            label: 'Como está se sentindo desde a última consulta?',
            type: 'textarea',
            required: false,
            max_length: 500,
          },
        ],
      },
    ],
  },

  {
    id: 'salao_beleza',
    name: 'Salão de beleza',
    description:
      'Cabelo, manicure, estética. Coleta serviço desejado, comprimento e alergias.',
    emoji: '💇',
    persona: {
      name: 'Bianca',
      role: 'receptionist',
      tone: 'casual',
      personality:
        'Animada, descolada e antenada em tendências. Conversa com leveza, sugere serviços compatíveis com o que a cliente descreve, faz a pessoa se sentir à vontade.',
      guidelines: [
        'Identifique qual serviço a cliente quer (corte, coloração, manicure, etc.)',
        'Pergunte sobre comprimento atual e desejado (quando aplicável)',
        'Verifique se tem alergia a químicos (importante pra colorações/quimicas)',
        'Se for primeira vez, peça referência (foto, descrição)',
      ],
      forbidden_topics: [],
      greeting_message:
        'Oi{{contact.first_name}}, tudo bem? Sou a Bianca, do salão. Em que posso te ajudar hoje?',
      fallback_message:
        'Vou chamar uma das meninas pra continuar com você. Já já alguém te responde por aqui!',
    },
    business_context:
      'Salão de beleza completo: cabelo, manicure, estética facial e corporal. Atende público feminino e masculino.',
    suggested_specialties: [
      'corte feminino',
      'corte masculino',
      'coloração',
      'mechas',
      'progressiva',
      'manicure',
      'pedicure',
      'design de sobrancelhas',
      'limpeza de pele',
    ],
    suggested_appointment_types: [
      {
        name: 'Corte e finalização',
        description: 'Corte com lavagem e finalização',
        duration_minutes: 60,
        buffer_minutes: 15,
        location_type: 'presencial',
        color: '#EC4899',
        custom_fields_schema: [
          {
            key: 'comprimento_atual',
            label: 'Comprimento atual',
            type: 'select',
            required: true,
            options: ['Curto', 'Médio', 'Longo', 'Muito longo'],
          },
          {
            key: 'corte_desejado',
            label: 'O que tem em mente?',
            type: 'textarea',
            required: false,
            max_length: 500,
            placeholder: 'Manter comprimento, mudar visual, foto referência...',
          },
        ],
      },
      {
        name: 'Coloração',
        description: 'Tintura ou retoque de raiz',
        duration_minutes: 120,
        buffer_minutes: 15,
        location_type: 'presencial',
        color: '#A855F7',
        custom_fields_schema: [
          {
            key: 'alergia_quimica',
            label: 'Tem alergia a algum químico?',
            type: 'boolean',
            required: true,
          },
          {
            key: 'cor_desejada',
            label: 'Cor desejada',
            type: 'text',
            required: true,
            max_length: 100,
            placeholder: 'Ex: castanho 6.0, loiro acinzentado...',
          },
        ],
      },
    ],
  },

  {
    id: 'oficina_mecanica',
    name: 'Oficina mecânica',
    description:
      'Manutenção e reparos automotivos. Coleta marca/modelo/ano e sintoma.',
    emoji: '🔧',
    persona: {
      name: 'Roberto',
      role: 'receptionist',
      tone: 'semiformal',
      personality:
        'Direto, técnico e prestativo. Faz perguntas objetivas pra entender o problema sem enrolação. Não enche o cliente de jargão técnico desnecessário.',
      guidelines: [
        'Sempre pergunte marca, modelo e ano do veículo',
        'Identifique o sintoma ou serviço que está procurando (revisão, ruído, falha, etc.)',
        'Pergunte quilometragem aproximada se for revisão',
        'Avalie se é emergência (carro parado, vazamento de óleo) ou agendamento normal',
      ],
      forbidden_topics: [
        'diagnóstico definitivo sem ver o carro',
        'orçamento fechado por mensagem',
      ],
      greeting_message:
        'Olá{{contact.first_name}}! Aqui é o Roberto, da oficina. Em que posso te ajudar com o seu carro?',
      fallback_message:
        'Vou passar pra um dos mecânicos te orientar melhor. Já já alguém te responde!',
    },
    business_context:
      'Oficina mecânica multimarca. Atende carros leves, revisões, suspensão, motor, elétrica e ar-condicionado.',
    suggested_specialties: [
      'motor',
      'suspensão',
      'freios',
      'elétrica',
      'ar-condicionado',
      'alinhamento',
      'revisão geral',
    ],
    suggested_appointment_types: [
      {
        name: 'Diagnóstico',
        description: 'Avaliação inicial do problema',
        duration_minutes: 60,
        buffer_minutes: 15,
        location_type: 'presencial',
        color: '#F59E0B',
        custom_fields_schema: [
          {
            key: 'marca',
            label: 'Marca',
            type: 'text',
            required: true,
            max_length: 50,
            placeholder: 'Fiat, Chevrolet, Volkswagen...',
          },
          {
            key: 'modelo',
            label: 'Modelo',
            type: 'text',
            required: true,
            max_length: 50,
          },
          {
            key: 'ano',
            label: 'Ano',
            type: 'number',
            required: true,
            min: 1980,
            max: 2030,
          },
          {
            key: 'sintoma',
            label: 'O que está acontecendo?',
            type: 'textarea',
            required: true,
            max_length: 1000,
            placeholder: 'Barulho, falha, vazamento, luz no painel...',
          },
          {
            key: 'km',
            label: 'Quilometragem aproximada',
            type: 'number',
            required: false,
            min: 0,
          },
        ],
      },
      {
        name: 'Revisão programada',
        description: 'Revisão de manutenção preventiva',
        duration_minutes: 180,
        buffer_minutes: 30,
        location_type: 'presencial',
        color: '#3B82F6',
        custom_fields_schema: [
          {
            key: 'marca',
            label: 'Marca',
            type: 'text',
            required: true,
            max_length: 50,
          },
          {
            key: 'modelo',
            label: 'Modelo',
            type: 'text',
            required: true,
            max_length: 50,
          },
          {
            key: 'km',
            label: 'Quilometragem atual',
            type: 'number',
            required: true,
            min: 0,
          },
        ],
      },
    ],
  },

  {
    id: 'consultoria_b2b',
    name: 'Consultoria / B2B',
    description:
      'Vendas consultivas, agência. Qualifica decisor, faturamento e objetivo.',
    emoji: '💼',
    persona: {
      name: 'Marina',
      role: 'sales_assistant',
      tone: 'semiformal',
      personality:
        'Profissional, articulada e estratégica. Conduz com perguntas inteligentes que mostram interesse genuíno no negócio do prospect. Sem pressão, foca em entender o problema antes de qualquer pitch.',
      guidelines: [
        'Identifique se quem está falando é o decisor ou influenciador',
        'Pergunte sobre o segmento e tamanho da empresa',
        'Entenda qual é o problema/objetivo principal hoje',
        'Avalie urgência (precisa pra próximo trimestre? já está em projeto?)',
      ],
      forbidden_topics: [
        'preço fechado sem entender o escopo',
        'comparação direta com concorrentes',
      ],
      greeting_message:
        'Olá{{contact.first_name}}, sou a Marina. Que bom ter você aqui! Como posso te ajudar?',
      fallback_message:
        'Vou conectar você com um dos consultores especializados pra dar continuidade. Em breve alguém entra em contato!',
    },
    business_context:
      'Consultoria B2B / agência. Atende empresas que querem otimizar processos, vender mais ou implementar tecnologia.',
    suggested_specialties: [
      'vendas',
      'marketing',
      'tecnologia',
      'processos',
      'consultoria estratégica',
    ],
    suggested_appointment_types: [
      {
        name: 'Discovery call',
        description: 'Conversa inicial de descoberta',
        duration_minutes: 30,
        buffer_minutes: 15,
        location_type: 'online',
        color: '#06B6D4',
        custom_fields_schema: [
          {
            key: 'empresa',
            label: 'Nome da empresa',
            type: 'text',
            required: true,
            max_length: 120,
          },
          {
            key: 'cargo',
            label: 'Seu cargo',
            type: 'text',
            required: true,
            max_length: 80,
          },
          {
            key: 'segmento',
            label: 'Segmento',
            type: 'text',
            required: false,
            max_length: 80,
          },
          {
            key: 'tamanho',
            label: 'Tamanho da empresa',
            type: 'select',
            required: false,
            options: ['1-10', '11-50', '51-200', '201-1000', '1000+'],
          },
          {
            key: 'objetivo',
            label: 'Qual é o principal desafio?',
            type: 'textarea',
            required: true,
            max_length: 1000,
          },
        ],
      },
    ],
  },

  {
    id: 'imobiliaria',
    name: 'Imobiliária',
    description: 'Compra/aluguel/venda. Coleta tipo, faixa e localização.',
    emoji: '🏠',
    persona: {
      name: 'Patrícia',
      role: 'sales_assistant',
      tone: 'friendly',
      personality:
        'Atenciosa, pragmática e organizada. Faz o cliente se sentir cuidado, mas sem enrolação. Foca em entender o que ele realmente busca pra não perder tempo de ninguém.',
      guidelines: [
        'Identifique se é interesse de compra, aluguel ou venda',
        'Pergunte tipo de imóvel (casa, apartamento, sala comercial)',
        'Identifique região/bairro de interesse',
        'Pergunte faixa de preço aproximada (sem ser invasiva)',
      ],
      forbidden_topics: ['preço fechado sem visita', 'avaliação sem documentação'],
      greeting_message:
        'Olá{{contact.first_name}}! Sou a Patrícia, da imobiliária. Como posso te ajudar?',
      fallback_message:
        'Vou pedir pra um corretor especializado continuar com você. Em instantes alguém te responde!',
    },
    business_context:
      'Imobiliária com portfólio amplo: residencial, comercial e investimentos. Compra, venda e locação.',
    suggested_specialties: [
      'residencial - venda',
      'residencial - aluguel',
      'comercial',
      'lançamentos',
      'avaliação',
    ],
    suggested_appointment_types: [
      {
        name: 'Visita ao imóvel',
        description: 'Visita presencial pra conhecer um imóvel',
        duration_minutes: 60,
        buffer_minutes: 30,
        location_type: 'presencial',
        color: '#84CC16',
        custom_fields_schema: [
          {
            key: 'tipo_interesse',
            label: 'Está procurando para',
            type: 'select',
            required: true,
            options: ['Comprar', 'Alugar', 'Investir'],
          },
          {
            key: 'tipo_imovel',
            label: 'Tipo de imóvel',
            type: 'select',
            required: true,
            options: ['Casa', 'Apartamento', 'Sala comercial', 'Terreno', 'Outros'],
          },
          {
            key: 'regiao',
            label: 'Região / bairro',
            type: 'text',
            required: true,
            max_length: 200,
          },
          {
            key: 'faixa_preco',
            label: 'Faixa de preço aproximada',
            type: 'text',
            required: false,
            max_length: 100,
            placeholder: 'Ex: até 500 mil, 1 a 2 milhões...',
          },
        ],
      },
    ],
  },

  {
    id: 'restaurante',
    name: 'Restaurante / Delivery',
    description: 'Reservas e pedidos. Coleta horário, pessoas e preferências.',
    emoji: '🍽️',
    persona: {
      name: 'Lucas',
      role: 'receptionist',
      tone: 'friendly',
      personality:
        'Caloroso, ágil e atencioso. Faz o cliente se sentir bem-vindo, sugere pratos quando perguntado, confirma detalhes da reserva sem ser robótico.',
      guidelines: [
        'Identifique se é reserva no salão, delivery ou retirada',
        'Pergunte data, horário e número de pessoas (pra reserva)',
        'Verifique restrições alimentares ou alergias',
        'Confirme se é ocasião especial (aniversário, comemoração)',
      ],
      forbidden_topics: [],
      greeting_message:
        'Oi{{contact.first_name}}, tudo bem? Sou o Lucas, do restaurante. Em que posso te ajudar?',
      fallback_message:
        'Vou avisar a equipe e em segundinhos alguém te responde!',
    },
    business_context:
      'Restaurante com salão, delivery e retirada. Cardápio rotativo, ocasiões especiais sob reserva.',
    suggested_specialties: ['reserva salão', 'delivery', 'retirada', 'eventos privados'],
    suggested_appointment_types: [
      {
        name: 'Reserva no salão',
        description: 'Mesa reservada pra clientes',
        duration_minutes: 90,
        buffer_minutes: 0,
        location_type: 'presencial',
        color: '#EAB308',
        custom_fields_schema: [
          {
            key: 'pessoas',
            label: 'Quantas pessoas?',
            type: 'number',
            required: true,
            min: 1,
            max: 30,
          },
          {
            key: 'ocasiao',
            label: 'É alguma ocasião especial?',
            type: 'text',
            required: false,
            max_length: 200,
            placeholder: 'Aniversário, comemoração, encontro... (opcional)',
          },
          {
            key: 'restricoes',
            label: 'Alguma restrição alimentar / alergia?',
            type: 'textarea',
            required: false,
            max_length: 500,
          },
        ],
      },
    ],
  },
];

/** Lookup por id. Retorna null se não existir. */
export function getPersonaTemplate(id: string): PersonaTemplate | null {
  return PERSONA_TEMPLATES.find((t) => t.id === id) ?? null;
}
