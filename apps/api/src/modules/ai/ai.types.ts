/**
 * Tipos e schemas JSON do módulo de IA. Schemas são usados via
 * `output_config.format` (json_schema) pra forçar o modelo a retornar JSON
 * válido contra o shape esperado.
 *
 * Limitações do structured outputs do Claude:
 *  - `additionalProperties: false` é obrigatório em todo objeto
 *  - Não suporta minimum/maximum/minLength etc. — validação numérica fica
 *    no código (ex: confidence clamp 0..1).
 */

export type AIIntent =
  | 'budget'
  | 'question'
  | 'complaint'
  | 'negotiation'
  | 'support'
  | 'greeting'
  | 'farewell'
  | 'spam'
  | 'other';

export type AIUrgency = 'low' | 'medium' | 'high' | 'critical';

export interface ClassificationResult {
  intent: AIIntent;
  sentiment: 'very_positive' | 'positive' | 'neutral' | 'negative' | 'very_negative';
  temperature: 'cold' | 'warm' | 'hot' | 'very_hot';
  urgency: AIUrgency;
  /** Resumo em 1 frase do que o cliente quer */
  summary: string;
}

export interface SuggestionResult {
  suggested_response: string;
  /** 0..1 — clamp aplicado pós-parse (json_schema não suporta minimum/maximum) */
  confidence: number;
  reasoning: string;
}

// ──────────────────────────────────────────────────────────
// JSON Schemas (passados como `output_config.format.schema`)
// ──────────────────────────────────────────────────────────

export const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [
        'budget',
        'question',
        'complaint',
        'negotiation',
        'support',
        'greeting',
        'farewell',
        'spam',
        'other',
      ],
    },
    sentiment: {
      type: 'string',
      enum: ['very_positive', 'positive', 'neutral', 'negative', 'very_negative'],
    },
    temperature: {
      type: 'string',
      enum: ['cold', 'warm', 'hot', 'very_hot'],
    },
    urgency: {
      type: 'string',
      enum: ['low', 'medium', 'high', 'critical'],
    },
    summary: { type: 'string' },
  },
  required: ['intent', 'sentiment', 'temperature', 'urgency', 'summary'],
  additionalProperties: false,
} as const;

export const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    suggested_response: { type: 'string' },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
  },
  required: ['suggested_response', 'confidence', 'reasoning'],
  additionalProperties: false,
} as const;

// ──────────────────────────────────────────────────────────
// Deal scoring
// ──────────────────────────────────────────────────────────

export type DealRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface DealScoreFactors {
  /** 0-25: engajamento do contato nas mensagens */
  engagement: number;
  /** 0-25: recência da última interação */
  recency: number;
  /** 0-25: adequação do perfil ao produto */
  fit: number;
  /** 0-25: sinais de intenção de compra */
  intent: number;
  /** Detalhes textuais explicando cada peso */
  details: string[];
}

export interface DealScoreResult {
  /** 0-100, soma dos 4 fatores */
  score: number;
  risk: DealRiskLevel;
  /** 0-100, probabilidade estimada de fechar */
  close_probability: number;
  /** Próxima ação sugerida — pt-BR, max ~100 chars */
  next_action: string;
  factors: DealScoreFactors;
}

export const DEAL_SCORE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer' },
    risk: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    close_probability: { type: 'integer' },
    next_action: { type: 'string' },
    factors: {
      type: 'object',
      properties: {
        engagement: { type: 'integer' },
        recency: { type: 'integer' },
        fit: { type: 'integer' },
        intent: { type: 'integer' },
        details: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['engagement', 'recency', 'fit', 'intent', 'details'],
      additionalProperties: false,
    },
  },
  required: ['score', 'risk', 'close_probability', 'next_action', 'factors'],
  additionalProperties: false,
} as const;

export const DEAL_SCORE_SYSTEM_PROMPT =
  'Você é um analista comercial brasileiro. Avalie este negócio com base nos dados fornecidos. Considere quatro fatores, cada um valendo de 0 a 25 pontos: (1) engagement — quão engajado o cliente está nas conversas (frequência, qualidade, perguntas); (2) recency — recência da última interação (mais recente = mais pontos); (3) fit — adequação do perfil do contato ao produto/preço; (4) intent — sinais explícitos de intenção de compra (pediu orçamento, mencionou prazo, comparou opções). O score final é a soma dos quatro (0-100). Risk reflete o risco de NÃO fechar (low → muito provável fechar; critical → praticamente perdido). Em next_action, sugira a próxima ação concreta em português, máximo 100 chars. Retorne APENAS JSON válido.';

// ──────────────────────────────────────────────────────────
// Funnel analysis
// ──────────────────────────────────────────────────────────

export interface FunnelAnalysisResult {
  total_pipeline_value: number;
  weighted_value: number;
  bottleneck_stage: string | null;
  bottleneck_reason: string | null;
  avg_cycle_days: number;
  /** 0-1 (0% a 100%) */
  conversion_rate: number;
  insights: string[];
  recommendations: string[];
}

/**
 * Schema do funnel analysis.
 *
 * **Importante**: campos numéricos determinísticos (`total_pipeline_value`,
 * `weighted_value`, `avg_cycle_days`, `conversion_rate`) são CALCULADOS no
 * código antes de chamar o modelo, passados via prompt, e SOBRESCRITOS na
 * resposta — o modelo só insere insights/recommendations/bottleneck. Isso
 * garante precisão das métricas financeiras (Claude pode errar somas).
 */
export const FUNNEL_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    total_pipeline_value: { type: 'number' },
    weighted_value: { type: 'number' },
    bottleneck_stage: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    bottleneck_reason: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    avg_cycle_days: { type: 'number' },
    conversion_rate: { type: 'number' },
    insights: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'total_pipeline_value',
    'weighted_value',
    'bottleneck_stage',
    'bottleneck_reason',
    'avg_cycle_days',
    'conversion_rate',
    'insights',
    'recommendations',
  ],
  additionalProperties: false,
} as const;

export const FUNNEL_ANALYSIS_SYSTEM_PROMPT =
  'Você é um consultor de vendas analisando um funil comercial brasileiro. Identifique gargalos (stages onde deals param/acumulam), avalie o ritmo do funil, e forneça 3-5 insights acionáveis + 2-3 recomendações concretas em português brasileiro. Os números determinísticos (total_pipeline_value, weighted_value, avg_cycle_days, conversion_rate) já foram calculados pelo sistema e estão no prompt — você pode COPIÁ-LOS no JSON sem recalcular. Foque em IDENTIFICAR padrões e PRESCREVER ações. Insights devem ser observações ("X stage tem 60% dos deals parados há mais de 7 dias"); recommendations devem ser ações ("Crie automação de follow-up nessa stage"). Retorne APENAS JSON válido.';

// ──────────────────────────────────────────────────────────
// Constantes de modelo
// ──────────────────────────────────────────────────────────

/** Alias canônico (preferido sobre o ID datado claude-haiku-4-5-20251001). */
export const HAIKU_MODEL_ID = 'claude-haiku-4-5';

/**
 * Pricing 2026 (atualizou recentemente — antes era $0.80/$4.00).
 * Verificar periodicamente: https://platform.claude.com/docs/en/pricing
 */
export const HAIKU_PRICING = {
  input_per_mtok_usd: 1.0,
  output_per_mtok_usd: 5.0,
} as const;

// ──────────────────────────────────────────────────────────
// System prompts
// ──────────────────────────────────────────────────────────

export const CLASSIFY_SYSTEM_PROMPT =
  'Você é um classificador de mensagens comerciais brasileiras. Analise a mensagem do cliente e o contexto da conversa. Retorne APENAS JSON válido sem texto adicional, contendo: intent (intenção principal), sentiment (sentimento detectado), temperature (temperatura do lead), urgency (urgência) e summary (resumo em 1 frase do que o cliente quer).';

export const SUGGEST_SYSTEM_PROMPT =
  'Você é um assistente comercial brasileiro. Sugira uma resposta natural em português para o vendedor enviar ao cliente. Conduza a conversa em direção ao fechamento. Não invente informações sobre produtos, preços ou condições que não estejam explicitamente no contexto. A resposta deve ser concisa, educada e específica. Retorne JSON com: suggested_response (texto pronto pra enviar), confidence (0 a 1) e reasoning (justificativa curta da sua sugestão).';

export const SUMMARIZE_SYSTEM_PROMPT =
  'Você analisa conversas comerciais brasileiras e produz resumos curtos (2-3 frases) em português. Foque em: o que o cliente quer, em que estágio da negociação está, e qual a próxima ação esperada. Não invente fatos. Retorne apenas o resumo, sem prefixos como "Resumo:" ou aspas.';

// ──────────────────────────────────────────────────────────
// Gaps detection (Melhoria 7) — Haiku, JSON estruturado
// ──────────────────────────────────────────────────────────

export interface GapsResult {
  unanswered_questions: Array<{
    /** Texto da pergunta como apareceu na conversa (paráfrase ok). */
    question: string;
    /** Index 0-based da mensagem na lista enviada ao prompt. */
    message_index: number;
  }>;
  missing_profile_data: Array<{
    /** Campo do contato (email, phone, company, name, tags, segment). */
    field: string;
    /** Razão prática pela qual o vendedor deveria coletar isso agora. */
    reason: string;
  }>;
  /** Ações sugeridas pra próxima mensagem do vendedor. */
  suggested_actions: string[];
}

export const GAPS_SCHEMA = {
  type: 'object',
  properties: {
    unanswered_questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          message_index: { type: 'integer' },
        },
        required: ['question', 'message_index'],
        additionalProperties: false,
      },
    },
    missing_profile_data: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['field', 'reason'],
        additionalProperties: false,
      },
    },
    suggested_actions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['unanswered_questions', 'missing_profile_data', 'suggested_actions'],
  additionalProperties: false,
} as const;

// ──────────────────────────────────────────────────────────
// Scheduling intent detection (Bloco Agendamentos)
// ──────────────────────────────────────────────────────────

export interface SchedulingIntentResult {
  wants_scheduling: boolean;
  appointment_type_guess: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  urgency: 'low' | 'medium' | 'high';
  extracted_text: string;
}

export const SCHEDULING_INTENT_SCHEMA = {
  type: 'object',
  properties: {
    wants_scheduling: { type: 'boolean' },
    appointment_type_guess: { type: ['string', 'null'] },
    preferred_date: { type: ['string', 'null'] },
    preferred_time: { type: ['string', 'null'] },
    urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
    extracted_text: { type: 'string' },
  },
  required: [
    'wants_scheduling',
    'appointment_type_guess',
    'preferred_date',
    'preferred_time',
    'urgency',
    'extracted_text',
  ],
  additionalProperties: false,
} as const;

export const SCHEDULING_INTENT_SYSTEM_PROMPT =
  'Você analisa mensagens comerciais brasileiras pra detectar intenção de agendamento. ' +
  'Sinais: "agendar", "marcar", "horário", "disponibilidade", "quando posso", "tem agenda", ' +
  '"reunião", "visita", "consulta", "ligar mais tarde". ' +
  'Se a mensagem indica desejo de agendar, retorne wants_scheduling=true e extraia: ' +
  'appointment_type_guess (reunion/call/visit ou null se não claro), preferred_date ' +
  '(YYYY-MM-DD se mencionada hoje/amanhã/dia da semana, senão null — interprete relativo a HOJE), ' +
  'preferred_time (HH:mm 24h ou null), urgency (low|medium|high — alta se "urgente"/"agora"). ' +
  'extracted_text é o trecho exato da mensagem que sinalizou. Se NÃO há intenção clara, ' +
  'retorne wants_scheduling=false e os outros campos null. Retorne APENAS JSON válido.';

export const GAPS_SYSTEM_PROMPT =
  'Você é um analista de conversas comerciais brasileiras. Analise a conversa e o perfil do contato fornecidos. Identifique TRÊS coisas e retorne APENAS JSON válido contra o schema:\n' +
  '1) unanswered_questions: perguntas FEITAS PELO CLIENTE que o vendedor não respondeu adequadamente (ou ignorou). Use o message_index da pergunta original.\n' +
  '2) missing_profile_data: campos do contato que estão "(faltando)" no perfil acima E que seriam ÚTEIS pra avançar essa venda específica. Não liste todos os faltantes — só os relevantes. Para cada um, dê uma razão curta e prática (ex: "Email pra enviar proposta por escrito").\n' +
  '3) suggested_actions: 2-4 ações concretas pra próxima mensagem do vendedor (ex: "Responder sobre prazo de entrega", "Confirmar email pra envio").\n' +
  'Se não houver gaps, retorne arrays vazios. Não invente. Use português brasileiro.';
