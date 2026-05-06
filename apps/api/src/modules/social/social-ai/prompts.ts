import type { BrandContext } from '../social.types';

/**
 * System prompts e builders pra geração de conteúdo via Claude.
 */

export function buildBrandContextBlock(ctx: BrandContext): string {
  const parts: string[] = [];
  parts.push('CONTEXTO DA MARCA:');
  parts.push(`- Nome: ${ctx.identity.name}`);
  if (ctx.identity.niche) parts.push(`- Nicho: ${ctx.identity.niche}`);
  if (ctx.identity.target_audience)
    parts.push(`- Público: ${ctx.identity.target_audience}`);
  if (ctx.identity.value_proposition)
    parts.push(`- Proposta: ${ctx.identity.value_proposition}`);
  parts.push(`- Tom: ${ctx.identity.tone}`);
  parts.push(`- Cor primária: ${ctx.identity.primary_color}`);
  if (ctx.business.main_cta) parts.push(`- CTA principal: ${ctx.business.main_cta}`);

  if (ctx.business.differentials.length > 0) {
    parts.push(`- Diferenciais: ${ctx.business.differentials.join('; ')}`);
  }
  if (ctx.business.pain_points.length > 0) {
    parts.push(`- Dores do público: ${ctx.business.pain_points.join('; ')}`);
  }

  parts.push(`- Uso de emojis: ${ctx.content_rules.emoji_usage}`);
  parts.push(`- Estratégia de hashtags: ${ctx.content_rules.hashtag_strategy}`);

  if (ctx.content_rules.forbidden_words.length > 0) {
    parts.push(`- Palavras proibidas: ${ctx.content_rules.forbidden_words.join(', ')}`);
  }
  if (ctx.content_rules.preferred_words.length > 0) {
    parts.push(`- Palavras preferidas: ${ctx.content_rules.preferred_words.join(', ')}`);
  }

  if (ctx.knowledge_summary) {
    parts.push(`\nCONHECIMENTO RELEVANTE:\n${ctx.knowledge_summary}`);
  }
  if (ctx.persona) {
    parts.push(`\nPERSONA: ${ctx.persona.name}\n${ctx.persona.system_prompt}`);
  }

  return parts.join('\n');
}

export const CALENDAR_SYSTEM_PROMPT = `Você é um estrategista de conteúdo digital sênior. Crie calendários editoriais para Instagram/TikTok que sejam estratégicos, variados e direcionados ao objetivo da marca.

REGRAS:
- Distribua os pilares conforme o mix solicitado
- Considere melhores horários (Instagram: 11h, 14h, 19h; TikTok: 18-21h)
- Varie formatos (post, carousel, reel) — nunca tudo igual
- Cada item deve ter: tema específico, hook impactante, brief acionável, CTA, hashtags
- Português brasileiro
- Respeite palavras proibidas e preferidas da marca
- Considere datas especiais e campanhas se fornecidas

Retorne APENAS JSON válido com este shape:
{
  "calendar_name": string,
  "items": [{
    "date": "YYYY-MM-DD",
    "time": "HH:MM",
    "channel": "instagram" | "tiktok",
    "content_type": "post" | "carousel" | "reel",
    "pillar": "educational" | "promotional" | "social_proof" | "entertainment" | "institutional",
    "theme": string,
    "hook": string,
    "brief": string,
    "cta": string,
    "hashtags_suggested": [string],
    "needs_image": boolean
  }]
}`;

export const POST_SYSTEM_PROMPT = `Você é um copywriter especialista em redes sociais brasileiras. Crie posts de Instagram que convertem.

REGRAS:
- Caption: até 2200 chars com quebras de linha estratégicas
- Hook nas primeiras 2 linhas (antes do "ver mais")
- Emojis no estilo configurado pela marca
- 8-15 hashtags relevantes (mistura de niche + broad conforme estratégia)
- CTA claro no final
- Gerar prompt visual detalhado pra IA de imagem (descreva cores, composição, elementos — SEM TEXTO na imagem)
- Alt text acessível
- Português brasileiro

Retorne APENAS JSON:
{
  "caption": string,
  "hashtags": [string],
  "image_prompt": string,
  "alt_text": string
}`;

export const CAROUSEL_SYSTEM_PROMPT = `Você é um copywriter especialista em carrosséis de Instagram que viralizam. Crie carrosséis com narrativa clara e progressão.

REGRAS:
- 5-10 slides (default 7)
- Slide 1 = capa: hook visual + promessa clara
- Slides do meio: desenvolvimento com 1 ideia por slide
- Slide final: CTA forte
- Cada slide tem: title curto (até 6 palavras), body conciso (até 30 palavras), visual_prompt detalhado
- Caption do post (até 1200 chars) explica o conteúdo + CTA pra ler o carrossel
- 8-15 hashtags
- Português brasileiro

Retorne APENAS JSON:
{
  "caption": string,
  "hashtags": [string],
  "slides": [{
    "slide_number": number,
    "type": "cover" | "intro" | "content" | "cta",
    "title": string,
    "subtitle": string,
    "body": string,
    "visual_prompt": string,
    "background_style": "gradient" | "solid" | "image",
    "cta_button": string
  }]
}`;
