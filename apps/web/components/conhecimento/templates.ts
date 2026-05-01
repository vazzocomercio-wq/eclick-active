import type { KnowledgeCategory } from '@eclick-active/shared';

export interface DocumentTemplate {
  id: string;
  label: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
}

/**
 * Templates pré-prontos pra acelerar onboarding. O usuário clica, o
 * Dialog é preenchido com title + category + esqueleto de content.
 */
export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'products-pricing',
    label: 'Produtos e Preços',
    category: 'products',
    title: 'Catálogo de produtos e preços',
    content: `# Produtos e Preços

## Produto 1
- **Descrição**: ...
- **Preço**: R$ ...
- **Diferencial**: ...

## Produto 2
- **Descrição**: ...
- **Preço**: R$ ...
- **Diferencial**: ...

## Pacotes / Combos
- ...

## Política de descontos
- Desconto progressivo a partir de X unidades
- Desconto fidelidade: ...
`,
  },
  {
    id: 'commercial-policies',
    label: 'Políticas Comerciais',
    category: 'policies',
    title: 'Políticas comerciais',
    content: `# Políticas Comerciais

## Formas de pagamento
- À vista: 5% de desconto
- Parcelado: até X vezes sem juros
- Boleto / PIX / Cartão

## Frete e entrega
- Prazo: ...
- Frete grátis a partir de R$ ...
- Cobertura: ...

## Trocas e devoluções
- Prazo de 7 dias após recebimento
- Produto deve estar lacrado e sem uso

## Garantia
- ...
`,
  },
  {
    id: 'faq',
    label: 'FAQ',
    category: 'faq',
    title: 'Perguntas Frequentes',
    content: `# FAQ

**P: Quanto tempo demora a entrega?**
R: ...

**P: Vocês fazem trocas?**
R: ...

**P: Como rastreio meu pedido?**
R: ...

**P: Vocês emitem nota fiscal?**
R: Sim, sempre.

**P: Há garantia nos produtos?**
R: ...
`,
  },
  {
    id: 'sales-scripts',
    label: 'Scripts de Venda',
    category: 'scripts',
    title: 'Scripts de venda',
    content: `# Scripts de Venda

## Abertura
"Olá [NOME]! Tudo bem? Aqui é [VENDEDOR] do [EMPRESA]. Posso te ajudar com..."

## Apresentação do produto
"Pelo que você me disse, acho que [PRODUTO] é o que combina mais com você porque..."

## Tratamento de preço
"Entendo que o investimento parece alto. Olha só o que você ganha por esse valor: ..."

## Fechamento
"Posso reservar pra você? Confirma no PIX/cartão para garantirmos hoje?"

## Pós-venda
"Recebeu certinho? Qualquer coisa, estou aqui."
`,
  },
  {
    id: 'objections',
    label: 'Objeções e Respostas',
    category: 'objections',
    title: 'Objeções comuns e respostas',
    content: `# Objeções comuns

## "Está caro"
Reposicionar valor: liste benefícios concretos, comparar com alternativas, parcelar.

## "Vou pensar"
Fazer pergunta de qualificação: "Qual a sua maior dúvida agora? Posso te ajudar a decidir."

## "Já tenho um fornecedor"
Diferenciação: o que entregamos que o atual não entrega? Foco em ganho percebido.

## "Não tenho tempo agora"
Compromisso futuro concreto: "Quando seria um bom momento para a gente conversar? Posso te ligar amanhã às X?"

## "Preciso falar com meu sócio"
Facilitar a venda interna: oferecer material por escrito que ele possa apresentar.
`,
  },
];
