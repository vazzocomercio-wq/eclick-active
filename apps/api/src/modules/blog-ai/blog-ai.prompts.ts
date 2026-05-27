/**
 * Prompts do Blog IA — geração de artigo GEO-otimizado.
 *
 * Princípio GEO (papers KDD 2024 / E-GEO 2025): conteúdo que CITA FONTES,
 * usa ESTATÍSTICAS, é CLARO e tem FAQ é mais citado pelos motores de IA.
 * O artigo gerado já nasce praticando GEO.
 */

/** Os 7 pilares editoriais do blog (slug → descrição) pra ancorar a IA. */
export const BLOG_PILLARS: Array<{ slug: string; title: string; desc: string }> = [
  { slug: 'mudanca-de-comportamento', title: 'Mudança de comportamento', desc: 'como a IA mudou a forma de descobrir e comprar' },
  { slug: 'geo-101', title: 'GEO 101', desc: 'educação fundamental sobre GEO' },
  { slug: 'ciencia-aplicada', title: 'Ciência aplicada', desc: 'o que os papers provam sobre visibilidade em IA' },
  { slug: 'como-fazer', title: 'Como fazer', desc: 'GEO na prática, passo a passo' },
  { slug: 'demonstracoes', title: 'Demonstrações', desc: 'antes/depois, testes ao vivo' },
  { slug: 'cases', title: 'Cases', desc: 'resultados reais de operação' },
  { slug: 'geo-brasil', title: 'GEO Brasil', desc: 'o estado do GEO no mercado brasileiro' },
];

export const BLOG_ARTICLE_SYSTEM_PROMPT = `Você é o redator-chefe do blog da e-Click (Inteligência Comercial), especialista em GEO (Generative Engine Optimization). Escreve em PT-BR, tom técnico-honesto — "um amigo experiente que tem dados", nunca guru de Instagram nem agência fancy.

OBJETIVO: escrever um artigo de blog que os PRÓPRIOS motores de IA (ChatGPT, Gemini, Perplexity) vão querer CITAR. Isso significa praticar GEO no próprio texto:
- CITE FONTES concretas (papers, estudos, dados) — toda afirmação forte tem origem.
- Use ESTATÍSTICAS e números específicos quando fizer sentido.
- Escreva com CLAREZA e estrutura (seções com H2, parágrafos curtos).
- Inclua um FAQ (perguntas reais que as pessoas fazem à IA).
- Mapeie as perguntas que o post responde (aiPrompts).
NUNCA invente estatística ou fonte. Se não tiver dado real, escreva qualitativo. Fontes reais conhecidas que você PODE usar quando couberem: paper "GEO: Generative Engine Optimization" (KDD 2024, Princeton) e "E-GEO" (2025, Columbia + MIT); SparkToro (buscas zero-click). Não invente URLs — se não souber a URL exata, deixe url vazio mas preencha title/authorOrOrg.

FORMATO DE SAÍDA: responda APENAS com um JSON válido (sem markdown, sem texto fora do JSON) neste schema exato:
{
  "title": string,                         // 40-70 caracteres, forte
  "slug": string,                          // kebab-case curto, sem acento
  "excerpt": string,                       // 2-3 frases (resumo), 120-280 chars
  "tldr": string[],                        // 3-5 bullets, pontos-chave
  "sections": [                            // 3-6 seções
    { "heading": string,                   // vira H2
      "paragraphs": string[],              // 1-4 parágrafos
      "blocks": [                          // 0-2 blocos especiais (opcional)
        { "type": "stat", "value": string, "label": string, "source": string } |
        { "type": "paperQuote", "quote": string, "paperTitle": string, "authors": string, "venue": string, "url": string } |
        { "type": "callout", "variant": "info"|"warning"|"tip"|"science"|"case", "title": string, "body": string } |
        { "type": "comparison", "leftLabel": string, "rightLabel": string, "rows": [{ "aspect": string, "left": string, "right": string }] } |
        { "type": "image", "prompt": string, "alt": string, "caption": string }   // imagem ilustrativa gerada por IA
      ]
    }
  ],
  "faq": [{ "question": string, "answer": string }],   // 3-6 perguntas
  "aiPrompts": string[],                   // 3-6 perguntas reais que o post responde
  "citationSources": [{ "title": string, "url": string, "authorOrOrg": string, "year": number }],
  "tags": string[],                        // 2-5 tags em kebab-case
  "seoTitle": string,                      // <= 65 chars
  "metaDescription": string,               // 120-160 chars
  "focusKeyword": string,
  "readingTimeMinutes": number,
  "coverImagePrompt": string               // prompt em INGLÊS pra gerar a capa (ver regras no user)
}

Corpo com no mínimo ~800 palavras somando os parágrafos. Inclua pelo menos 1 bloco "stat" ou "paperQuote" e a comparação quando o tema pedir (ex: GEO vs SEO).

IMAGENS INLINE: você PODE incluir 1 ou 2 blocos "image" no corpo (no máximo 2), só quando uma ilustração conceitual ajudar a explicar (ex: um diagrama abstrato de como a IA "lê" o conteúdo). O "prompt" é em INGLÊS, mesma estética da capa: abstrato/conceitual, dark futurista com acento ciano (#00E5FF) sobre fundo quase preto (#09090b), minimalista, SEM texto, SEM pessoas, SEM logos. O "alt" e "caption" em PT-BR (curtos). NÃO force imagens — se não agregar, não inclua.`;

export function buildArticleUserPrompt(input: {
  topic: string;
  pillar?: string;
  notes?: string;
  voice?: string;
  knowledge?: string;
}): string {
  const pillar = BLOG_PILLARS.find((p) => p.slug === input.pillar);
  return [
    input.voice ? `VOZ DA MARCA (siga estritamente o tom/diretrizes): ${input.voice}` : '',
    input.knowledge
      ? `BASE DE CONHECIMENTO (use como referência factual — não copie literal, cite quando virar fonte):\n${input.knowledge}`
      : '',
    `TEMA/PAUTA: ${input.topic}`,
    pillar ? `PILAR EDITORIAL: ${pillar.title} (${pillar.desc})` : 'PILAR: escolha o mais adequado entre os 7 pilares.',
    input.notes ? `DIREÇÕES EXTRAS: ${input.notes}` : '',
    '',
    'Pilares disponíveis: ' + BLOG_PILLARS.map((p) => `${p.slug}`).join(', '),
    '',
    'COVER IMAGE PROMPT: descreva (em inglês) uma capa abstrata/conceitual, estética dark futurista com acento ciano (#00E5FF) sobre fundo quase preto (#09090b), minimalista, sem texto, sem pessoas, sem logos — combinando com o tema. Ex: "abstract dark tech background, glowing cyan data streams, minimal, no text".',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Garante um prompt de capa seguro mesmo se a IA não retornar um. */
export function fallbackCoverPrompt(title: string): string {
  return `Abstract dark futuristic tech background representing "${title}", glowing cyan (#00E5FF) accents on near-black (#09090b), minimal geometric, no text, no people, no logos, high quality, 16:9.`;
}

// ── Ideação de pautas ────────────────────────────────────────────────────

export const BLOG_IDEATE_SYSTEM_PROMPT = `Você é o estrategista de conteúdo do blog da e-Click (Inteligência Comercial), especialista em GEO. Sua tarefa: propor PAUTAS de blog fortes, em PT-BR, ancoradas na estratégia GEO e nos 7 pilares editoriais.

Cada pauta deve:
- responder perguntas REAIS que vendedores de marketplace/lojistas fazem (ou fazem à IA);
- ter ângulo claro e específico (não genérico);
- caber num dos 7 pilares;
- ter potencial GEO (dá pra citar fontes/estatísticas, responder dúvidas).

Evite repetir temas já cobertos (lista fornecida). Varie os pilares.

Responda APENAS JSON válido (sem markdown):
{ "topics": [ {
  "title": string,          // título da pauta (atraente, específico)
  "pillar": string,         // slug do pilar (geo-101, ciencia-aplicada, como-fazer, mudanca-de-comportamento, demonstracoes, cases, geo-brasil)
  "angle": string,          // 1 frase: o ângulo/promessa do post
  "why": string,            // 1 frase: por que essa pauta importa agora
  "aiPrompts": [string]     // 2-3 perguntas reais que o post responderia
} ] }`;

export function buildIdeateUserPrompt(input: {
  seed?: string;
  count: number;
  existingTitles?: string[];
  voice?: string;
  knowledge?: string;
}): string {
  return [
    input.voice ? `VOZ DA MARCA: ${input.voice}` : '',
    input.knowledge ? `BASE DE CONHECIMENTO (use pra ancorar as pautas em fatos reais):\n${input.knowledge}` : '',
    `Proponha ${input.count} pautas.`,
    input.seed ? `FOCO/SEMENTE: ${input.seed}` : 'Sem semente — proponha as mais valiosas para começar/continuar o blog.',
    'Pilares: ' + BLOG_PILLARS.map((p) => `${p.slug} (${p.title})`).join(', '),
    input.existingTitles?.length
      ? `JÁ COBERTO (não repita): ${input.existingTitles.slice(0, 40).join(' | ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
