/**
 * Templates de pipeline por segmento. Usado no `POST /pipelines/from-template`
 * pra bootstrap rápido de organizações novas. Cada template traz os stages
 * principais com cores e probability sensatas; os stages "Ganho" e "Perdido"
 * são adicionados automaticamente pelo service.
 */

export type PipelineTemplateKey =
  | 'ecommerce'
  | 'clinica'
  | 'imobiliaria'
  | 'educacao'
  | 'servicos_b2b'
  | 'energia_solar';

export interface PipelineTemplateStage {
  name: string;
  color: string;
  probability: number;
}

export interface PipelineTemplateMeta {
  key: PipelineTemplateKey;
  /** Nome default do pipeline criado a partir do template. */
  default_name: string;
  /** Texto curto pra UI explicar o template. */
  description: string;
  /** Ícone lucide pra UI (ex: 'shopping-cart', 'stethoscope'). */
  icon: string;
  stages: PipelineTemplateStage[];
}

const ECOMMERCE: PipelineTemplateStage[] = [
  { name: 'Novo Lead', color: '#00E5FF', probability: 5 },
  { name: 'Interesse Confirmado', color: '#0EA5E9', probability: 20 },
  { name: 'Orçamento Solicitado', color: '#8B5CF6', probability: 40 },
  { name: 'Proposta Enviada', color: '#F59E0B', probability: 60 },
  { name: 'Negociação', color: '#EF4444', probability: 80 },
  { name: 'Pedido Confirmado', color: '#22C55E', probability: 95 },
];

const CLINICA: PipelineTemplateStage[] = [
  { name: 'Primeiro Contato', color: '#00E5FF', probability: 10 },
  { name: 'Agendamento', color: '#0EA5E9', probability: 30 },
  { name: 'Consulta Realizada', color: '#8B5CF6', probability: 50 },
  { name: 'Orçamento Apresentado', color: '#F59E0B', probability: 70 },
  { name: 'Tratamento Aceito', color: '#22C55E', probability: 90 },
];

const IMOBILIARIA: PipelineTemplateStage[] = [
  { name: 'Lead Recebido', color: '#00E5FF', probability: 5 },
  { name: 'Visita Agendada', color: '#0EA5E9', probability: 20 },
  { name: 'Visita Realizada', color: '#8B5CF6', probability: 40 },
  { name: 'Proposta', color: '#F59E0B', probability: 60 },
  { name: 'Documentação', color: '#EF4444', probability: 80 },
  { name: 'Fechamento', color: '#22C55E', probability: 95 },
];

const EDUCACAO: PipelineTemplateStage[] = [
  { name: 'Interessado', color: '#00E5FF', probability: 10 },
  { name: 'Informações Enviadas', color: '#0EA5E9', probability: 25 },
  { name: 'Aula Experimental', color: '#8B5CF6', probability: 50 },
  { name: 'Matrícula Pendente', color: '#F59E0B', probability: 75 },
  { name: 'Matriculado', color: '#22C55E', probability: 95 },
];

const SERVICOS_B2B: PipelineTemplateStage[] = [
  { name: 'Prospecção', color: '#00E5FF', probability: 5 },
  { name: 'Qualificação', color: '#0EA5E9', probability: 15 },
  { name: 'Apresentação', color: '#8B5CF6', probability: 35 },
  { name: 'Proposta Comercial', color: '#F59E0B', probability: 55 },
  { name: 'Negociação', color: '#EF4444', probability: 75 },
  { name: 'Contrato', color: '#22C55E', probability: 90 },
];

const ENERGIA_SOLAR: PipelineTemplateStage[] = [
  { name: 'Lead', color: '#00E5FF', probability: 5 },
  { name: 'Dados Coletados', color: '#0EA5E9', probability: 15 },
  { name: 'Projeto Dimensionado', color: '#8B5CF6', probability: 35 },
  { name: 'Proposta Enviada', color: '#F59E0B', probability: 55 },
  { name: 'Visita Técnica', color: '#EF4444', probability: 75 },
  { name: 'Contrato Assinado', color: '#22C55E', probability: 95 },
];

export const PIPELINE_TEMPLATES: Record<PipelineTemplateKey, PipelineTemplateMeta> = {
  ecommerce: {
    key: 'ecommerce',
    default_name: 'Funil E-commerce',
    description: 'Vendas online: do interesse ao pedido confirmado.',
    icon: 'shopping-cart',
    stages: ECOMMERCE,
  },
  clinica: {
    key: 'clinica',
    default_name: 'Funil Clínica',
    description: 'Saúde/estética: do primeiro contato ao tratamento aceito.',
    icon: 'stethoscope',
    stages: CLINICA,
  },
  imobiliaria: {
    key: 'imobiliaria',
    default_name: 'Funil Imobiliário',
    description: 'Venda/locação: lead, visita, proposta, fechamento.',
    icon: 'home',
    stages: IMOBILIARIA,
  },
  educacao: {
    key: 'educacao',
    default_name: 'Funil Educação',
    description: 'Cursos e escolas: do interesse à matrícula.',
    icon: 'graduation-cap',
    stages: EDUCACAO,
  },
  servicos_b2b: {
    key: 'servicos_b2b',
    default_name: 'Funil B2B',
    description: 'Vendas consultivas: prospecção até contrato.',
    icon: 'briefcase',
    stages: SERVICOS_B2B,
  },
  energia_solar: {
    key: 'energia_solar',
    default_name: 'Funil Energia Solar',
    description: 'Da captação ao contrato: dimensionamento, proposta, instalação.',
    icon: 'sun',
    stages: ENERGIA_SOLAR,
  },
};

/** Stages padrão de "fechamento" adicionados ao final de TODO template. */
export const TEMPLATE_CLOSING_STAGES: Array<
  PipelineTemplateStage & { is_won?: boolean; is_lost?: boolean }
> = [
  { name: 'Ganho', color: '#22C55E', probability: 100, is_won: true },
  { name: 'Perdido', color: '#6B7280', probability: 0, is_lost: true },
];

export const PIPELINE_TEMPLATE_KEYS = Object.keys(PIPELINE_TEMPLATES) as PipelineTemplateKey[];
