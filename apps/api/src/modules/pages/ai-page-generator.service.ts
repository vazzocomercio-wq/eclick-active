import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import type {
  AiPageGenerationInput,
  AiPageImprovement,
  Page,
  PageBlock,
  PageType,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { LlmService } from '../../common/llm/llm.service';

interface OrgContext {
  org_name: string;
  products_summary: string;
  primary_color: string;
  tone: string;
  whatsapp_phone?: string;
}

@Injectable()
export class AiPageGeneratorService {
  private readonly logger = new Logger(AiPageGeneratorService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // Org context — coletado uma vez por chamada pra enriquecer o prompt
  // ──────────────────────────────────────────────────────────

  private async getOrgContext(orgId: string): Promise<OrgContext> {
    const [orgRes, productsRes, personaRes, channelsRes] = await Promise.all([
      this.supabase.adminClient
        .from('organizations')
        .select('name')
        .eq('id', orgId)
        .maybeSingle(),
      this.supabase.adminClient
        .from('products_catalog')
        .select('name, description, price, currency, images')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .limit(20),
      this.supabase.adminClient
        .from('ai_personas')
        .select('tone, primary_color')
        .eq('org_id', orgId)
        .maybeSingle(),
      this.supabase.adminClient
        .from('channels')
        .select('phone_number, channel_type')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .in('channel_type', ['whatsapp', 'whatsapp_free'])
        .limit(1),
    ]);

    const products =
      ((productsRes.data ?? []) as Array<{
        name: string;
        description: string | null;
        price: number | null;
        currency: string;
      }>);
    const productsSummary =
      products.length === 0
        ? 'Nenhum produto cadastrado'
        : products
            .slice(0, 10)
            .map(
              (p) =>
                `- ${p.name}${p.price ? ` (${p.price.toLocaleString('pt-BR', { style: 'currency', currency: p.currency })})` : ''}${p.description ? `: ${p.description.slice(0, 100)}` : ''}`,
            )
            .join('\n');

    const personaData = (personaRes as { data?: { tone?: string; primary_color?: string } | null })
      .data;
    const channels = (channelsRes.data ?? []) as { phone_number: string | null }[];

    return {
      org_name: (orgRes.data as { name?: string } | null)?.name ?? 'Sua Empresa',
      products_summary: productsSummary,
      primary_color: personaData?.primary_color ?? '#00E5FF',
      tone: personaData?.tone ?? 'profissional e amigável',
      whatsapp_phone: channels[0]?.phone_number ?? undefined,
    };
  }

  // ──────────────────────────────────────────────────────────
  // generatePage — o killer feature
  // ──────────────────────────────────────────────────────────

  async generatePage(
    orgId: string,
    input: AiPageGenerationInput,
  ): Promise<{
    name: string;
    page_type: PageType;
    seo: Record<string, unknown>;
    global_styles: Record<string, unknown>;
    blocks: PageBlock[];
    metadata: Record<string, unknown>;
  }> {
    const ctx = await this.getOrgContext(orgId);
    const { catalogProducts } = await this.fetchCatalogIfNeeded(
      orgId,
      input.use_catalog_products ?? false,
    );

    const systemPrompt = this.buildSystemPrompt(ctx, input);
    const userPrompt = this.buildUserPrompt(input, catalogProducts);

    this.logger.log(`Gerando página AI: type=${input.page_type}, ctx_products=${catalogProducts.length}`);

    const json = await this.callLlmJson(orgId, 'page_generate', systemPrompt, userPrompt, 8192);

    const blocks = this.normalizeBlocks(
      (json.blocks as Record<string, unknown>[]) ?? [],
      input,
      ctx,
    );

    return {
      name: (json.name as string) ?? input.description.slice(0, 50),
      page_type: input.page_type,
      seo: (json.seo as Record<string, unknown>) ?? {},
      global_styles: (json.global_styles as Record<string, unknown>) ?? {
        primary_color: ctx.primary_color,
      },
      blocks,
      metadata: {
        ai_generated: true,
        ai_prompt: input.description,
        generated_at: new Date().toISOString(),
      },
    };
  }

  // ──────────────────────────────────────────────────────────
  // generateBlock — adicionar bloco individual
  // ──────────────────────────────────────────────────────────

  async generateBlock(
    orgId: string,
    blockType: string,
    description: string,
    existingBlocks: PageBlock[],
  ): Promise<PageBlock> {
    const ctx = await this.getOrgContext(orgId);
    const summary = existingBlocks
      .slice(0, 8)
      .map((b) => `- ${b.type}`)
      .join('\n');

    const system = `Você cria blocos de landing page em JSON. Sempre retorne APENAS JSON válido.
Empresa: ${ctx.org_name}
Tom: ${ctx.tone}
Cor primária: ${ctx.primary_color}

Blocos já existentes na página (mantenha coerência visual e de conteúdo):
${summary}

Tipos de bloco disponíveis: hero, hero_video, heading, text, image, video, gallery, benefits, features, stats, testimonials, faq, about, team, timeline, comparison, countdown, banner, cta, form, whatsapp_button, product_grid, product_featured, pricing_table, two_columns, three_columns, navbar, footer, divider, spacer.`;

    const user = `Crie um bloco do tipo "${blockType}" com o seguinte conteúdo: ${description}

Retorne JSON com { type, content, settings }.`;

    const json = await this.callLlmJson(orgId, 'page_generate_block', system, user, 2048);

    return {
      id: this.uuid(),
      type: (json.type as PageBlock['type']) ?? (blockType as PageBlock['type']),
      content: (json.content as Record<string, unknown>) ?? {},
      settings: (json.settings as PageBlock['settings']) ?? { padding: 'md', max_width: 'lg' },
      position: existingBlocks.length,
    };
  }

  // ──────────────────────────────────────────────────────────
  // rewriteBlockContent — reescrever conteúdo de um bloco
  // ──────────────────────────────────────────────────────────

  async rewriteBlockContent(
    orgId: string,
    block: PageBlock,
    instruction: string,
  ): Promise<Record<string, unknown>> {
    const ctx = await this.getOrgContext(orgId);
    const system = `Você é um copywriter especialista em conversão. Reescreva o conteúdo de um bloco de página mantendo a estrutura JSON.
Empresa: ${ctx.org_name}
Tom: ${ctx.tone}

Retorne APENAS o objeto "content" reescrito (mantenha as mesmas chaves do original).`;

    const user = `Bloco atual (type=${block.type}):
${JSON.stringify(block.content, null, 2)}

Instrução: ${instruction}

Reescreva e retorne APENAS o objeto content.`;

    const json = await this.callLlmJson(orgId, 'page_rewrite_block', system, user, 2048);
    return json;
  }

  // ──────────────────────────────────────────────────────────
  // suggestImprovements
  // ──────────────────────────────────────────────────────────

  async suggestImprovements(orgId: string, page: Page): Promise<AiPageImprovement[]> {
    const ctx = await this.getOrgContext(orgId);
    const blockSummary = page.blocks
      .map((b) => `[${b.id}] ${b.type}`)
      .join('\n');

    const system = `Você é um expert em CRO (Conversion Rate Optimization). Analise uma página e retorne 3-7 sugestões acionáveis.
Cada sugestão tem: severity (info/warning/critical), category (cta/copy/design/social_proof/seo/performance/mobile), title curto (5-10 palavras), description (1-2 frases), action opcional.

Retorne JSON: { improvements: [...] }`;

    const user = `Empresa: ${ctx.org_name}
Tipo: ${page.page_type}
Nome: ${page.name}

Blocos:
${blockSummary}

SEO atual:
title: ${page.seo.title ?? 'AUSENTE'}
description: ${page.seo.description ?? 'AUSENTE'}

Que melhorias você sugere?`;

    const json = await this.callLlmJson(orgId, 'page_improvements', system, user, 2048);
    const list = (json.improvements as AiPageImprovement[]) ?? [];
    return list.slice(0, 10);
  }

  // ──────────────────────────────────────────────────────────
  // generateProductDescriptions — para loja
  // ──────────────────────────────────────────────────────────

  async generateProductDescriptions(
    orgId: string,
    products: { name: string; current_description?: string }[],
  ): Promise<{ name: string; description: string }[]> {
    if (products.length === 0) return [];
    const ctx = await this.getOrgContext(orgId);
    const system = `Você é um copywriter de e-commerce. Crie descrições de produto curtas (40-70 palavras), focadas em benefícios + características, em PT-BR. Tom: ${ctx.tone}.

Retorne JSON: { items: [{ name, description }] }`;
    const user = `Produtos:
${products.map((p, i) => `${i + 1}. ${p.name}${p.current_description ? ` — atual: ${p.current_description.slice(0, 80)}` : ''}`).join('\n')}

Reescreva cada um com descrição vendedora.`;

    const json = await this.callLlmJson(orgId, 'page_product_descriptions', system, user, 2048);
    return ((json.items as { name: string; description: string }[]) ?? []).slice(0, products.length);
  }

  // ──────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────

  private buildSystemPrompt(ctx: OrgContext, input: AiPageGenerationInput): string {
    return `Você é um web designer e copywriter especialista em conversão. Crie uma ${this.pageTypeLabel(input.page_type)} profissional baseada na descrição do usuário.

CONTEXTO DA EMPRESA:
- Nome: ${ctx.org_name}
- Tom de voz: ${ctx.tone}
- Cor primária sugerida: ${ctx.primary_color}
- Produtos:
${ctx.products_summary}

REGRAS:
- Retorne APENAS JSON válido no formato especificado
- Copy em português brasileiro, profissional e persuasivo
- Foco em CONVERSÃO: CTA claro, benefícios antes de features, prova social
- Mobile-first
- Mínimo 8 blocos, máximo 14
- Use blocos de tipos variados pra criar ritmo visual
- Para LOJA: inclua product_grid + product_featured com produtos reais
- Para LANDING/SALES: inclua hero forte, benefits, testimonials, faq, cta, form
- Para LINK_IN_BIO: hero compacto + lista de links (use blocos cta encadeados)
- SEO completo: title (50-60 chars), description (150-160 chars)
- Cores baseadas em ${ctx.primary_color} (primary), com secondary complementar
- Sempre incluir navbar no início e footer no fim
${input.include_whatsapp && ctx.whatsapp_phone ? `- INCLUIR floating_cta whatsapp com phone="${ctx.whatsapp_phone}"` : ''}
${input.include_form ? '- INCLUIR bloco form (use form_id="auto" — será wired depois)' : ''}

ESTRUTURA DOS BLOCOS:
- hero: { headline, subheadline, cta_text, cta_href, image?, layout? "centered"|"split" }
- benefits: { title, items: [{ icon (emoji), title, description }] }
- stats: { title?, items: [{ number, label, suffix?, prefix? }] }
- testimonials: { title, items: [{ name, role?, company?, text, photo?, stars? }] }
- faq: { title, items: [{ question, answer }] }
- features: { title, items: [string] }
- cta: { title, subtitle?, button_text, button_href }
- product_grid: { title, columns: 2|3|4 }
- pricing_table: { title, plans: [{ name, price, period?, features: [string], cta_text, highlighted? }] }
- navbar: { logo_text, links: [{label, href}], cta_text?, cta_href? }
- footer: { logo, text, links: [{label, href}], social: [{network, url}], copyright }
- about: { title, text, image? }
- team: { title, items: [{name, role, photo?}] }
- timeline: { title, items: [{step, title, description}] }
- countdown: { title, target_date (ISO 8601) }
- banner: { text, cta_text, cta_href }
- whatsapp_button: { phone, message, text }
- floating_cta: { type: "whatsapp", phone, message }
- divider, spacer ({height: number})`;
  }

  private buildUserPrompt(
    input: AiPageGenerationInput,
    catalogProducts: { name: string; price: number | null; description: string | null }[],
  ): string {
    let prompt = `Tipo de página: ${input.page_type}\n\nDescrição do que o usuário quer:\n${input.description}`;
    if (catalogProducts.length > 0 && input.use_catalog_products) {
      prompt += `\n\nProdutos disponíveis pra usar (escolha os mais relevantes):\n${catalogProducts
        .slice(0, 12)
        .map((p, i) => `${i + 1}. ${p.name}${p.price ? ` - R$ ${p.price}` : ''}`)
        .join('\n')}`;
    }
    return prompt;
  }

  private pageTypeLabel(t: PageType): string {
    const map: Record<PageType, string> = {
      landing: 'landing page de captura de leads',
      store: 'loja online com catálogo',
      booking: 'página de agendamento',
      link_in_bio: 'página tipo Link in Bio (compacta, mobile-first)',
      sales_page: 'página de vendas longa (long-form sales letter)',
      thank_you: 'página de agradecimento (pós-conversão)',
    };
    return map[t];
  }

  private async fetchCatalogIfNeeded(
    orgId: string,
    use: boolean,
  ): Promise<{
    catalogProducts: { name: string; price: number | null; description: string | null }[];
  }> {
    if (!use) return { catalogProducts: [] };
    const { data } = await this.supabase.adminClient
      .from('products_catalog')
      .select('name, price, description')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .limit(20);
    return { catalogProducts: (data ?? []) as never };
  }

  /**
   * Chama LlmService com json_mode e parseia a resposta como JSON.
   * Tolerância: tira markdown fences se vierem, regex pra primeiro {...} se
   * o parse direto falhar. Lança 500 com texto amigável se nada bate.
   */
  private async callLlmJson(
    orgId: string,
    feature: string,
    system: string,
    user: string,
    maxTokens: number,
  ): Promise<Record<string, unknown>> {
    const res = await this.llm.chat({
      orgId,
      feature,
      system,
      user,
      max_tokens: maxTokens,
      json_mode: true,
    });
    const cleaned = res.text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '');
    try {
      return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]) as Record<string, unknown>;
        } catch {
          /* falha duas vezes */
        }
      }
      this.logger.error(`JSON inválido da IA: ${cleaned.slice(0, 300)}`);
      throw new InternalServerErrorException('IA retornou JSON inválido');
    }
  }

  private normalizeBlocks(
    raw: Record<string, unknown>[],
    input: AiPageGenerationInput,
    ctx: OrgContext,
  ): PageBlock[] {
    const blocks: PageBlock[] = raw.map((b, idx) => ({
      id: this.uuid(),
      type: (b.type as PageBlock['type']) ?? 'text',
      content: (b.content as Record<string, unknown>) ?? {},
      settings: ((b.settings as PageBlock['settings']) ?? {
        padding: 'md',
        max_width: 'lg',
      }) as PageBlock['settings'],
      position: idx,
    }));

    // Se include_form e tem available_form_id, wire it up
    if (input.include_form && input.available_form_id) {
      for (const b of blocks) {
        if (b.type === 'form' && !b.content.form_id) {
          b.content.form_id = input.available_form_id;
        }
      }
    }
    // Se include_whatsapp e tem phone, garantir floating_cta
    if (input.include_whatsapp && ctx.whatsapp_phone) {
      const hasFloating = blocks.some((b) => b.type === 'floating_cta');
      if (!hasFloating) {
        blocks.push({
          id: this.uuid(),
          type: 'floating_cta',
          content: {
            type: 'whatsapp',
            phone: ctx.whatsapp_phone,
            message: `Olá! Vim através do site.`,
          },
          settings: { padding: 'md' },
          position: blocks.length,
        });
      }
    }
    return blocks;
  }

  private uuid(): string {
    return globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}
