import type { FormField, FormSettings, FormBranding } from '@eclick-active/shared';
import { randomUUID } from 'node:crypto';

export interface FormTemplate {
  category: string;
  name: string;
  description: string;
  fields: FormField[];
  settings: FormSettings;
  branding: FormBranding;
}

function field(partial: Omit<FormField, 'id'>): FormField {
  return { id: randomUUID(), ...partial };
}

const DEFAULT_BRANDING: FormBranding = {
  primary_color: '#00E5FF',
  show_powered_by: true,
};

const DEFAULT_SETTINGS: FormSettings = {
  assignment_rule: 'round_robin',
  success_message: 'Recebemos seu cadastro! Em breve um especialista vai entrar em contato.',
  auto_create_deal: true,
};

/**
 * Templates pré-prontos. O admin escolhe um e o backend clona os fields/
 * settings/branding pra um novo Form na org. Cada chamada gera UUIDs
 * novos pros field.ids — isolando submissões.
 */
export function getFormTemplates(): FormTemplate[] {
  return [
    // 1. Orçamento Genérico
    {
      category: 'orcamento',
      name: 'Orçamento Genérico',
      description: 'Captura de leads pra qualquer tipo de produto/serviço',
      fields: [
        field({ type: 'heading', label: 'Solicitar orçamento', position: 0, width: 'full', required: false, content: 'Preencha pra receber seu orçamento personalizado.' }),
        field({ type: 'text', label: 'Nome completo', placeholder: 'Seu nome', mapping: 'name', required: true, position: 1, width: 'full' }),
        field({ type: 'email', label: 'Email', placeholder: 'voce@email.com', mapping: 'email', required: false, position: 2, width: 'half' }),
        field({ type: 'phone', label: 'WhatsApp', placeholder: '(11) 99999-9999', mapping: 'phone', required: true, position: 3, width: 'half' }),
        field({ type: 'textarea', label: 'O que você precisa?', placeholder: 'Descreva...', mapping: 'notes', required: false, position: 4, width: 'full' }),
        field({
          type: 'select',
          label: 'Como nos conheceu?',
          required: false,
          position: 5,
          width: 'full',
          options: [
            { value: 'instagram', label: 'Instagram' },
            { value: 'google', label: 'Google' },
            { value: 'indicacao', label: 'Indicação' },
            { value: 'outro', label: 'Outro' },
          ],
        }),
      ],
      settings: { ...DEFAULT_SETTINGS, deal_title_template: 'Orçamento — {name}' },
      branding: DEFAULT_BRANDING,
    },

    // 2. Agendamento
    {
      category: 'agendamento',
      name: 'Agendamento de Atendimento',
      description: 'Agendar reunião, ligação ou visita com horário preferido',
      fields: [
        field({ type: 'heading', label: 'Agende seu atendimento', position: 0, width: 'full', required: false }),
        field({ type: 'text', label: 'Nome', mapping: 'name', required: true, position: 1, width: 'full' }),
        field({ type: 'phone', label: 'WhatsApp', mapping: 'phone', required: true, position: 2, width: 'half' }),
        field({ type: 'email', label: 'Email', mapping: 'email', required: false, position: 3, width: 'half' }),
        field({
          type: 'select',
          label: 'Tipo de atendimento',
          required: true,
          position: 4,
          width: 'full',
          options: [
            { value: 'reuniao_online', label: 'Reunião online' },
            { value: 'visita', label: 'Visita presencial' },
            { value: 'ligacao', label: 'Ligação' },
          ],
        }),
        field({ type: 'date', label: 'Data preferida', required: true, position: 5, width: 'half' }),
        field({
          type: 'select',
          label: 'Período',
          required: true,
          position: 6,
          width: 'half',
          options: [
            { value: 'manha', label: 'Manhã (9h-12h)' },
            { value: 'tarde', label: 'Tarde (13h-18h)' },
            { value: 'noite', label: 'Noite (19h-21h)' },
          ],
        }),
        field({ type: 'textarea', label: 'Observações', mapping: 'notes', required: false, position: 7, width: 'full' }),
      ],
      settings: { ...DEFAULT_SETTINGS, deal_title_template: 'Agendamento — {name}' },
      branding: DEFAULT_BRANDING,
    },

    // 3. Energia Solar
    {
      category: 'solar',
      name: 'Orçamento de Energia Solar',
      description: 'Captura de leads pra mercado de energia solar fotovoltaica',
      fields: [
        field({ type: 'heading', label: 'Quanto você economiza com solar?', position: 0, width: 'full', required: false, content: 'Receba um orçamento gratuito.' }),
        field({ type: 'text', label: 'Nome', mapping: 'name', required: true, position: 1, width: 'full' }),
        field({ type: 'phone', label: 'WhatsApp', mapping: 'phone', required: true, position: 2, width: 'half' }),
        field({ type: 'text', label: 'Cidade', placeholder: 'Sua cidade', required: false, position: 3, width: 'half' }),
        field({
          type: 'radio',
          label: 'Tipo de instalação',
          required: true,
          position: 4,
          width: 'full',
          options: [
            { value: 'residencial', label: 'Residencial' },
            { value: 'comercial', label: 'Comercial' },
            { value: 'industrial', label: 'Industrial' },
            { value: 'rural', label: 'Rural' },
          ],
        }),
        field({ type: 'number', label: 'Consumo mensal (kWh)', placeholder: '350', required: false, position: 5, width: 'half' }),
        field({
          type: 'radio',
          label: 'Já tem proposta de outra empresa?',
          required: false,
          position: 6,
          width: 'half',
          options: [
            { value: 'sim', label: 'Sim' },
            { value: 'nao', label: 'Não' },
          ],
        }),
      ],
      settings: { ...DEFAULT_SETTINGS, deal_title_template: 'Solar — {name}', auto_tags: ['solar'] },
      branding: DEFAULT_BRANDING,
    },

    // 4. Imobiliária
    {
      category: 'imobiliaria',
      name: 'Captura Imobiliária',
      description: 'Captura de interessados em imóveis (compra/aluguel)',
      fields: [
        field({ type: 'heading', label: 'Encontre seu imóvel ideal', position: 0, width: 'full', required: false }),
        field({ type: 'text', label: 'Nome', mapping: 'name', required: true, position: 1, width: 'full' }),
        field({ type: 'phone', label: 'WhatsApp', mapping: 'phone', required: true, position: 2, width: 'half' }),
        field({ type: 'email', label: 'Email', mapping: 'email', required: false, position: 3, width: 'half' }),
        field({
          type: 'select',
          label: 'Tipo de imóvel',
          required: true,
          position: 4,
          width: 'half',
          options: [
            { value: 'apartamento', label: 'Apartamento' },
            { value: 'casa', label: 'Casa' },
            { value: 'comercial', label: 'Comercial' },
            { value: 'terreno', label: 'Terreno' },
          ],
        }),
        field({
          type: 'select',
          label: 'Operação',
          required: true,
          position: 5,
          width: 'half',
          options: [
            { value: 'compra', label: 'Compra' },
            { value: 'aluguel', label: 'Aluguel' },
          ],
        }),
        field({ type: 'text', label: 'Bairro de interesse', placeholder: 'Ex: Moema, Vila Nova', required: false, position: 6, width: 'full' }),
        field({
          type: 'select',
          label: 'Faixa de preço',
          required: false,
          position: 7,
          width: 'half',
          options: [
            { value: 'ate_300k', label: 'Até R$ 300k' },
            { value: '300_600k', label: 'R$ 300k–600k' },
            { value: '600k_1mi', label: 'R$ 600k–1mi' },
            { value: 'acima_1mi', label: 'Acima de R$ 1mi' },
          ],
        }),
        field({
          type: 'radio',
          label: 'Vai usar financiamento?',
          required: false,
          position: 8,
          width: 'half',
          options: [
            { value: 'sim', label: 'Sim' },
            { value: 'nao', label: 'Não' },
            { value: 'nao_sei', label: 'Não sei' },
          ],
        }),
      ],
      settings: { ...DEFAULT_SETTINGS, deal_title_template: 'Imóvel — {name}', auto_tags: ['imobiliaria'] },
      branding: DEFAULT_BRANDING,
    },

    // 5. Curso/Educação
    {
      category: 'educacao',
      name: 'Inscrição em Curso',
      description: 'Captura de interessados em cursos e treinamentos',
      fields: [
        field({ type: 'heading', label: 'Inscreva-se no curso', position: 0, width: 'full', required: false }),
        field({ type: 'text', label: 'Nome completo', mapping: 'name', required: true, position: 1, width: 'full' }),
        field({ type: 'email', label: 'Email', mapping: 'email', required: true, position: 2, width: 'half' }),
        field({ type: 'phone', label: 'WhatsApp', mapping: 'phone', required: false, position: 3, width: 'half' }),
        field({
          type: 'select',
          label: 'Curso de interesse',
          required: true,
          position: 4,
          width: 'full',
          options: [
            { value: 'curso_a', label: 'Curso A' },
            { value: 'curso_b', label: 'Curso B' },
            { value: 'curso_c', label: 'Curso C' },
          ],
        }),
        field({
          type: 'select',
          label: 'Nível atual',
          required: false,
          position: 5,
          width: 'half',
          options: [
            { value: 'iniciante', label: 'Iniciante' },
            { value: 'intermediario', label: 'Intermediário' },
            { value: 'avancado', label: 'Avançado' },
          ],
        }),
        field({
          type: 'select',
          label: 'Como conheceu?',
          required: false,
          position: 6,
          width: 'half',
          options: [
            { value: 'instagram', label: 'Instagram' },
            { value: 'google', label: 'Google' },
            { value: 'youtube', label: 'YouTube' },
            { value: 'indicacao', label: 'Indicação' },
          ],
        }),
      ],
      settings: { ...DEFAULT_SETTINGS, deal_title_template: 'Curso — {name}' },
      branding: DEFAULT_BRANDING,
    },

    // 6. Contato B2B
    {
      category: 'b2b',
      name: 'Contato B2B',
      description: 'Captura de leads corporativos com qualificação de fit',
      fields: [
        field({ type: 'heading', label: 'Vamos conversar sobre seu projeto', position: 0, width: 'full', required: false }),
        field({ type: 'text', label: 'Nome', mapping: 'name', required: true, position: 1, width: 'half' }),
        field({ type: 'text', label: 'Cargo', placeholder: 'Ex: Diretor Comercial', required: false, position: 2, width: 'half' }),
        field({ type: 'text', label: 'Empresa', mapping: 'company', required: true, position: 3, width: 'full' }),
        field({ type: 'email', label: 'Email corporativo', mapping: 'email', required: true, position: 4, width: 'half' }),
        field({ type: 'phone', label: 'WhatsApp', mapping: 'phone', required: false, position: 5, width: 'half' }),
        field({ type: 'textarea', label: 'Qual a necessidade?', mapping: 'notes', required: true, position: 6, width: 'full' }),
        field({ type: 'currency', label: 'Orçamento estimado', mapping: 'value', required: false, position: 7, width: 'full' }),
      ],
      settings: { ...DEFAULT_SETTINGS, deal_title_template: 'B2B — {company}', auto_tags: ['b2b', 'enterprise'] },
      branding: DEFAULT_BRANDING,
    },
  ];
}
