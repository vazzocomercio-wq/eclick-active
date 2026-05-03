import type { PageType } from '@eclick-active/shared';

/**
 * Templates pré-definidos pra geração rápida. Cada template é uma
 * descrição que vira input pra IA. O Claude gera os blocks reais.
 */

export interface PageTemplate {
  id: string;
  name: string;
  emoji: string;
  category: string;
  page_type: PageType;
  description: string;
  ai_prompt: string;
  use_catalog_products?: boolean;
  include_form?: boolean;
  include_whatsapp?: boolean;
}

export const PAGE_TEMPLATES: PageTemplate[] = [
  // Landing Pages
  {
    id: 'solar',
    name: 'Energia Solar',
    emoji: '☀️',
    category: 'Landing Page',
    page_type: 'landing',
    description: 'Captura de leads pra empresa de energia solar',
    ai_prompt:
      'Landing page para empresa de energia solar. Hero com headline sobre economia, seção de benefícios (economia, sustentabilidade, valorização do imóvel), depoimentos de clientes, FAQ sobre instalação e financiamento, formulário de orçamento. Tom profissional, cores verde e azul.',
    include_form: true,
    include_whatsapp: true,
  },
  {
    id: 'imobiliaria',
    name: 'Imobiliária',
    emoji: '🏠',
    category: 'Landing Page',
    page_type: 'landing',
    description: 'Captação de leads pra imobiliária ou imóvel específico',
    ai_prompt:
      'Landing page para imobiliária com captação de leads pra apartamentos. Hero com imagem de empreendimento, seção de diferenciais (localização, lazer, segurança), galeria de imagens, depoimentos, formulário de interesse. Tom sofisticado.',
    include_form: true,
    include_whatsapp: true,
  },
  {
    id: 'clinica',
    name: 'Clínica Médica',
    emoji: '🏥',
    category: 'Landing Page',
    page_type: 'landing',
    description: 'Página pra clínica com agendamento de consultas',
    ai_prompt:
      'Landing page de clínica médica com tom acolhedor. Hero institucional, serviços oferecidos (cards), equipe de especialistas, depoimentos de pacientes, FAQ sobre planos de saúde, formulário pra agendar consulta. Cores azul e branco.',
    include_form: true,
  },
  {
    id: 'curso',
    name: 'Curso Online',
    emoji: '🎓',
    category: 'Landing Page',
    page_type: 'sales_page',
    description: 'Página de vendas pra curso ou treinamento',
    ai_prompt:
      'Página de vendas pra curso online. Hero forte com transformação prometida, módulos do curso (timeline), depoimentos com resultados, comparação antes/depois, garantia, perguntas frequentes, CTA principal pra inscrição com countdown e bônus.',
    include_form: true,
  },
  {
    id: 'restaurante',
    name: 'Restaurante',
    emoji: '🍽️',
    category: 'Landing Page',
    page_type: 'landing',
    description: 'Site institucional pra restaurante',
    ai_prompt:
      'Página de restaurante com hero appetitoso, sobre o chef, cardápio em destaque, galeria de pratos, depoimentos, mapa/endereço, horário de funcionamento, botão WhatsApp pra reservas. Tom convidativo.',
    include_whatsapp: true,
  },
  {
    id: 'evento',
    name: 'Evento',
    emoji: '🎤',
    category: 'Landing Page',
    page_type: 'landing',
    description: 'Página de inscrição pra evento ou workshop',
    ai_prompt:
      'Landing page de evento/workshop. Hero com data e local, programação detalhada (timeline), palestrantes, valores e ingressos, FAQ, formulário de inscrição, countdown pra data do evento.',
    include_form: true,
  },
  {
    id: 'b2b',
    name: 'Serviços B2B',
    emoji: '🏢',
    category: 'Landing Page',
    page_type: 'landing',
    description: 'Página pra empresa de serviços B2B',
    ai_prompt:
      'Landing page B2B profissional. Hero com proposta de valor clara, problemas que resolvemos, casos de sucesso com logos de clientes, processo de trabalho (timeline), planos/preços, formulário pra demo. Tom corporativo.',
    include_form: true,
  },
  {
    id: 'saas',
    name: 'SaaS / Software',
    emoji: '💻',
    category: 'Landing Page',
    page_type: 'landing',
    description: 'Site pra produto SaaS/software',
    ai_prompt:
      'Landing page de SaaS moderna. Hero com hero shot do produto, features principais com ícones, integrações, planos de preços (free/pro/enterprise), depoimentos, FAQ, CTA pra trial gratuito.',
    include_form: true,
  },
  {
    id: 'servicos',
    name: 'Serviços Diversos',
    emoji: '🛠️',
    category: 'Landing Page',
    page_type: 'landing',
    description: 'Genérico pra prestação de serviços',
    ai_prompt:
      'Landing page de prestador de serviços. Hero, sobre nós, serviços oferecidos, processo de trabalho, depoimentos, formulário de orçamento, botão WhatsApp.',
    include_form: true,
    include_whatsapp: true,
  },

  // Lojas
  {
    id: 'store_general',
    name: 'Loja Geral',
    emoji: '🛍️',
    category: 'Loja',
    page_type: 'store',
    description: 'Loja online com catálogo de produtos',
    ai_prompt:
      'Loja online completa. Navbar com carrinho, hero com banner promocional, grid de produtos com preços e botão comprar, seção de categorias, depoimentos de clientes, footer com formas de pagamento.',
    use_catalog_products: true,
    include_whatsapp: true,
  },
  {
    id: 'store_fashion',
    name: 'Moda',
    emoji: '👗',
    category: 'Loja',
    page_type: 'store',
    description: 'Loja de roupas/moda',
    ai_prompt:
      'Loja de moda elegante. Hero com modelo, coleções em destaque, grid de produtos com fotos grandes, depoimentos com fotos de clientes vestindo, FAQ sobre tamanhos e troca.',
    use_catalog_products: true,
    include_whatsapp: true,
  },
  {
    id: 'store_food',
    name: 'Alimentos',
    emoji: '🍕',
    category: 'Loja',
    page_type: 'store',
    description: 'Loja de alimentos / delivery',
    ai_prompt:
      'Loja de alimentos com cardápio. Hero appetitoso, categorias (entradas, principais, sobremesas), grid de produtos com fotos, depoimentos, área de cobertura, info de entrega.',
    use_catalog_products: true,
    include_whatsapp: true,
  },
  {
    id: 'store_cosmetics',
    name: 'Cosméticos',
    emoji: '💄',
    category: 'Loja',
    page_type: 'store',
    description: 'Loja de cosméticos',
    ai_prompt:
      'Loja de cosméticos premium. Hero feminino, categorias (skincare, maquiagem, perfumes), grid de produtos, ingredientes destacados, depoimentos com fotos antes/depois, FAQ.',
    use_catalog_products: true,
  },

  // Outros
  {
    id: 'booking',
    name: 'Agendamento',
    emoji: '📅',
    category: 'Outros',
    page_type: 'booking',
    description: 'Página de agendamento de horário',
    ai_prompt:
      'Página de agendamento de serviços. Hero com tipos de serviço disponíveis, escolha de profissional, horários disponíveis, formulário com nome/telefone, confirmação por WhatsApp.',
    include_whatsapp: true,
  },
  {
    id: 'link_bio',
    name: 'Link in Bio',
    emoji: '🔗',
    category: 'Outros',
    page_type: 'link_in_bio',
    description: 'Página compacta com vários links — ideal pra Instagram',
    ai_prompt:
      'Página tipo Linktree/link-in-bio. Compacta, mobile-first. Foto de perfil, nome, bio curta, lista de botões com links (site, WhatsApp, Instagram, YouTube, loja, contato). Cores vibrantes.',
    include_whatsapp: true,
  },
  {
    id: 'thank_you',
    name: 'Página de Obrigado',
    emoji: '✨',
    category: 'Outros',
    page_type: 'thank_you',
    description: 'Pós-conversão (após enviar formulário ou pagar)',
    ai_prompt:
      'Página de agradecimento após conversão. Mensagem de boas-vindas, próximos passos, sugestão de seguir nas redes sociais, contato pra dúvidas.',
  },
];

export const TEMPLATE_CATEGORIES = ['Landing Page', 'Loja', 'Outros'];
