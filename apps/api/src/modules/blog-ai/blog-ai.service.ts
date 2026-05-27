import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { LlmService } from '../../common/llm/llm.service';
import { ImageGenerationService } from '../social/image-generation/image-generation.service';
import { SanityBlogClient } from './sanity-blog.client';
import { BlogStudioService } from './blog-studio.service';
import {
  BLOG_PILLARS,
  buildArticleUserPrompt,
  buildIdeateUserPrompt,
  fallbackCoverPrompt,
} from './blog-ai.prompts';
import type {
  BlogPostRow,
  BlogTopicIdea,
  GenerateBlogPostDto,
  IdeateDto,
  PortableTextNode,
  RawArticle,
  RawArticleBlock,
  RawArticleSection,
} from './blog-ai.types';

const VALID_PILLARS = new Set(BLOG_PILLARS.map((p) => p.slug));
const DEFAULT_PILLAR = 'geo-101';

/**
 * Motor do Blog IA: gera artigo GEO-otimizado + capa via IA (fila de revisão),
 * e publica no Sanity (CMS canônico do blog) quando aprovado.
 */
@Injectable()
export class BlogAiService {
  private readonly log = new Logger(BlogAiService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
    private readonly images: ImageGenerationService,
    private readonly sanity: SanityBlogClient,
    private readonly studio: BlogStudioService,
  ) {}

  private get db() {
    return this.supabase.adminClient;
  }

  // ── Settings (tom de voz da marca) ───────────────────────────────────

  async getSettings(orgId: string): Promise<{ voice_guidelines: string | null }> {
    const { data } = await this.db
      .from('blog_settings')
      .select('voice_guidelines')
      .eq('org_id', orgId)
      .maybeSingle();
    return { voice_guidelines: (data as { voice_guidelines: string | null } | null)?.voice_guidelines ?? null };
  }

  async updateSettings(orgId: string, dto: { voice_guidelines?: string | null }): Promise<{ voice_guidelines: string | null }> {
    const { data, error } = await this.db
      .from('blog_settings')
      .upsert(
        { org_id: orgId, voice_guidelines: dto.voice_guidelines ?? null, updated_at: new Date().toISOString() },
        { onConflict: 'org_id' },
      )
      .select('voice_guidelines')
      .single();
    if (error) throw new BadRequestException(`blog_settings: ${error.message}`);
    return { voice_guidelines: (data as { voice_guidelines: string | null }).voice_guidelines };
  }

  /** Voz da marca (se configurada) pra injetar nos prompts. Best-effort. */
  private async getVoice(orgId: string): Promise<string | undefined> {
    try {
      const { voice_guidelines } = await this.getSettings(orgId);
      return voice_guidelines?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  // ── Geração ──────────────────────────────────────────────────────────

  async generateArticle(
    orgId: string,
    userId: string | null,
    dto: GenerateBlogPostDto,
  ): Promise<BlogPostRow> {
    if (!dto.topic?.trim()) throw new BadRequestException('Informe o tema/pauta.');
    const pillar = dto.pillar && VALID_PILLARS.has(dto.pillar) ? dto.pillar : DEFAULT_PILLAR;
    const postId = await this.createDraft(orgId, userId, dto.topic, pillar);
    return this.runGeneration(orgId, postId, dto.topic, pillar, dto.notes, dto.generateCover);
  }

  /** Cria a linha em 'generating' e devolve o id. */
  private async createDraft(orgId: string, userId: string | null, topic: string, pillar: string): Promise<string> {
    const { data, error } = await this.db
      .from('blog_posts')
      .insert({
        org_id: orgId,
        created_by: userId,
        title: topic.slice(0, 180),
        slug: `rascunho-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'generating',
        source_topic: topic,
        pillar,
        category: pillar,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(`blog_posts insert: ${error.message}`);
    return (data as { id: string }).id;
  }

  /** Núcleo da geração: LLM → Portable Text → capa → status 'review'. */
  private async runGeneration(
    orgId: string,
    postId: string,
    topic: string,
    pillar: string,
    notes?: string,
    generateCover = true,
  ): Promise<BlogPostRow> {
    const t0 = Date.now();
    try {
      const [voice, system, knowledge] = await Promise.all([
        this.getVoice(orgId),
        this.studio.resolveSystemPrompt(orgId, 'article'),
        this.studio.getKnowledgeBlock(orgId),
      ]);
      const out = await this.llm.chat({
        orgId,
        feature: 'blog_article',
        system,
        user: buildArticleUserPrompt({ topic, pillar, notes, voice, knowledge }),
        json_mode: true,
        max_tokens: 6000,
        temperature: 0.6,
        metadata: { post_id: postId, pillar },
      });
      const art = this.parseJson<RawArticle>(out.text);
      if (!art?.title || !art.sections?.length) {
        await this.markFailed(postId, 'IA retornou JSON inválido');
        throw new BadRequestException('Geração falhou — a IA não retornou um artigo válido.');
      }

      const body = this.toPortableText(art.sections);
      const slug = this.slugify(art.slug || art.title);

      // Imagens inline (até 2): só quando a capa também está habilitada.
      if (generateCover !== false) {
        await this.generateInlineImages(orgId, postId, body);
      } else {
        this.stripInlineImagePlaceholders(body);
      }

      let coverUrl: string | null = null;
      if (generateCover !== false) {
        try {
          const img = await this.images.generateAndUpload(
            orgId,
            {
              prompt: art.coverImagePrompt || fallbackCoverPrompt(art.title),
              primaryColor: '#00E5FF',
              secondaryColor: '#09090b',
              width: 1200,
              height: 630,
            },
            `blog/${postId}`,
          );
          coverUrl = img.url;
        } catch (e) {
          this.log.warn(`capa falhou (segue sem): ${(e as Error).message}`);
        }
      }

      const { data: updated, error: updErr } = await this.db
        .from('blog_posts')
        .update({
          title: art.title,
          slug,
          excerpt: art.excerpt ?? null,
          tldr: art.tldr ?? [],
          body,
          faq: art.faq ?? [],
          ai_prompts: art.aiPrompts ?? [],
          citation_sources: art.citationSources ?? [],
          tags: art.tags ?? [],
          cover_image_url: coverUrl,
          seo_title: art.seoTitle ?? null,
          meta_description: art.metaDescription ?? null,
          focus_keyword: art.focusKeyword ?? null,
          reading_time_minutes: art.readingTimeMinutes ?? null,
          status: 'review',
          cost_usd: out.cost_usd ?? 0,
          generation_metadata: {
            model: 'llm',
            latency_ms: Date.now() - t0,
            interaction_id: out.interaction_id,
            cover_prompt: art.coverImagePrompt ?? null,
          },
        })
        .eq('id', postId)
        .eq('org_id', orgId)
        .select('*')
        .single();
      if (updErr) throw new BadRequestException(`blog_posts update: ${updErr.message}`);

      this.log.log(`[blog-ai] artigo ${postId} gerado em ${Date.now() - t0}ms (review)`);
      return updated as BlogPostRow;
    } catch (e) {
      if (!(e instanceof BadRequestException)) await this.markFailed(postId, (e as Error).message);
      throw e;
    }
  }

  /**
   * Lote (autopilot): IA sugere N pautas → cria N rascunhos → gera em
   * background (sequencial, pra controlar custo/rate). Retorna as linhas
   * 'generating' na hora; a UI faz poll e elas viram 'review' conforme prontas.
   */
  async generateBatch(orgId: string, userId: string | null, dto: IdeateDto): Promise<BlogPostRow[]> {
    const { topics } = await this.ideate(orgId, dto);
    if (!topics.length) throw new BadRequestException('A IA não sugeriu pautas — tente outra semente.');
    const drafts: Array<{ id: string; topic: string; pillar: string }> = [];
    for (const tpc of topics) {
      const pillar = VALID_PILLARS.has(tpc.pillar) ? tpc.pillar : DEFAULT_PILLAR;
      const id = await this.createDraft(orgId, userId, tpc.title, pillar);
      drafts.push({ id, topic: tpc.title, pillar });
    }
    void this.runBatch(orgId, drafts);
    const { data } = await this.db.from('blog_posts').select('*').in(
      'id',
      drafts.map((d) => d.id),
    );
    return (data ?? []) as BlogPostRow[];
  }

  private async runBatch(orgId: string, drafts: Array<{ id: string; topic: string; pillar: string }>): Promise<void> {
    for (const d of drafts) {
      try {
        await this.runGeneration(orgId, d.id, d.topic, d.pillar);
      } catch (e) {
        this.log.warn(`[blog-ai] lote item ${d.id} falhou: ${(e as Error).message}`);
      }
    }
  }

  // ── Ideação de pautas ────────────────────────────────────────────────

  async ideate(orgId: string, dto: IdeateDto): Promise<{ topics: BlogTopicIdea[] }> {
    const count = Math.min(Math.max(dto.count ?? 5, 1), 10);
    const { data: existing } = await this.db
      .from('blog_posts')
      .select('title')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50);
    const existingTitles = ((existing ?? []) as Array<{ title: string }>).map((r) => r.title);

    const [voice, system, knowledge] = await Promise.all([
      this.getVoice(orgId),
      this.studio.resolveSystemPrompt(orgId, 'ideate'),
      this.studio.getKnowledgeBlock(orgId),
    ]);
    const out = await this.llm.chat({
      orgId,
      feature: 'blog_ideate',
      system,
      user: buildIdeateUserPrompt({ seed: dto.seed, count, existingTitles, voice, knowledge }),
      json_mode: true,
      max_tokens: 2000,
      temperature: 0.8,
    });
    const parsed = this.parseJson<{ topics?: BlogTopicIdea[] }>(out.text);
    const topics = (parsed?.topics ?? [])
      .filter((tpc): tpc is BlogTopicIdea => !!tpc && typeof tpc.title === 'string' && tpc.title.length > 0)
      .slice(0, count);
    return { topics };
  }

  // ── CRUD pipeline ────────────────────────────────────────────────────

  async list(orgId: string, status?: string): Promise<BlogPostRow[]> {
    let q = this.db.from('blog_posts').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(100);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(`blog_posts list: ${error.message}`);
    return (data ?? []) as BlogPostRow[];
  }

  async get(orgId: string, id: string): Promise<BlogPostRow> {
    const { data } = await this.db.from('blog_posts').select('*').eq('org_id', orgId).eq('id', id).maybeSingle();
    if (!data) throw new NotFoundException('Post não encontrado');
    return data as BlogPostRow;
  }

  async reject(orgId: string, id: string, reason?: string): Promise<BlogPostRow> {
    const { data, error } = await this.db
      .from('blog_posts')
      .update({ status: 'archived', rejected_reason: reason ?? null })
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as BlogPostRow;
  }

  // ── Agendamento ──────────────────────────────────────────────────────

  async schedule(orgId: string, id: string, scheduledForIso: string): Promise<BlogPostRow> {
    const when = new Date(scheduledForIso);
    if (Number.isNaN(when.getTime())) throw new BadRequestException('Data/hora inválida.');
    if (when.getTime() < Date.now() - 60_000) throw new BadRequestException('Agende para um horário futuro.');
    const row = await this.get(orgId, id);
    if (row.status === 'generating') throw new BadRequestException('Artigo ainda gerando.');
    if (row.status === 'published') throw new BadRequestException('Post já publicado.');
    const { data, error } = await this.db
      .from('blog_posts')
      .update({ status: 'scheduled', scheduled_for: when.toISOString() })
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as BlogPostRow;
  }

  async unschedule(orgId: string, id: string): Promise<BlogPostRow> {
    const { data, error } = await this.db
      .from('blog_posts')
      .update({ status: 'review', scheduled_for: null })
      .eq('org_id', orgId)
      .eq('id', id)
      .eq('status', 'scheduled')
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as BlogPostRow;
  }

  // ── Publicação no Sanity ─────────────────────────────────────────────

  async publish(orgId: string, id: string): Promise<BlogPostRow> {
    if (!this.sanity.isConfigured()) {
      throw new BadRequestException(
        'Publicação indisponível: configure SANITY_PROJECT_ID e SANITY_WRITE_TOKEN no servidor.',
      );
    }
    const row = await this.get(orgId, id);
    if (row.status === 'generating') throw new BadRequestException('Artigo ainda gerando.');

    // capa → asset no Sanity
    let coverAssetId: string | null = null;
    if (row.cover_image_url) {
      coverAssetId = await this.sanity.uploadImageFromUrl(row.cover_image_url);
    }

    // imagens inline (url → asset durável no Sanity/CDN)
    const body = await this.materializeBodyImages(row.body ?? []);

    const nowIso = new Date().toISOString();
    const pillar = row.pillar && VALID_PILLARS.has(row.pillar) ? row.pillar : DEFAULT_PILLAR;

    const doc: Record<string, unknown> & { _type: string; _id?: string } = {
      _type: 'post',
      _id: `blogpost-${row.id}`,
      title: row.title,
      slug: { _type: 'slug', current: row.slug },
      excerpt: row.excerpt ?? '',
      tldr: row.tldr ?? [],
      body,
      faq: (row.faq ?? []).map((f) => ({ _type: 'faqItem', _key: this.k(), question: f.question, answer: f.answer })),
      aiPrompts: row.ai_prompts ?? [],
      citationSources: (row.citation_sources ?? []).map((s) => ({
        _type: 'citationSource',
        _key: this.k(),
        title: s.title,
        url: s.url,
        authorOrOrg: s.authorOrOrg,
        year: s.year,
      })),
      category: { _type: 'reference', _ref: `category-${pillar}` },
      author: { _type: 'reference', _ref: 'author-silvio-junior' },
      ...(coverAssetId
        ? { coverImage: { _type: 'image', asset: { _type: 'reference', _ref: coverAssetId }, alt: row.title } }
        : {}),
      publishedAt: row.published_at ?? nowIso,
      updatedAt: nowIso,
      readingTimeMinutes: row.reading_time_minutes ?? undefined,
      seoTitle: row.seo_title ?? undefined,
      metaDescription: row.meta_description ?? undefined,
      focusKeyword: row.focus_keyword ?? undefined,
      status: 'published',
      newsletterSendOnPublish: false,
    };

    const sanityId = await this.sanity.createOrReplaceDocument(doc);

    const { data, error } = await this.db
      .from('blog_posts')
      .update({ status: 'published', sanity_doc_id: sanityId, published_at: nowIso })
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    void this.revalidateFront(row.slug);
    this.log.log(`[blog-ai] post ${id} publicado no Sanity (${sanityId})`);
    return data as BlogPostRow;
  }

  // ── helpers ──────────────────────────────────────────────────────────

  /**
   * Avisa o site público (eclick-frontend) pra revalidar o blog — assim o post
   * aparece na home/sitemap na hora, sem esperar o ISR. Best-effort (não
   * derruba o publish se falhar). Config: BLOG_REVALIDATE_URL + _SECRET.
   */
  private async revalidateFront(slug: string): Promise<void> {
    const url = process.env.BLOG_REVALIDATE_URL;
    const secret = process.env.BLOG_REVALIDATE_SECRET;
    if (!url || !secret) return;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, slug }),
      });
    } catch (e) {
      this.log.warn(`revalidate front falhou (non-fatal): ${(e as Error).message}`);
    }
  }

  private async markFailed(postId: string, reason: string): Promise<void> {
    await this.db.from('blog_posts').update({ status: 'failed', rejected_reason: reason.slice(0, 500) }).eq('id', postId);
  }

  private toPortableText(sections: RawArticleSection[]): PortableTextNode[] {
    const out: PortableTextNode[] = [];
    for (const s of sections ?? []) {
      if (s.heading?.trim()) out.push(this.textBlock('h2', s.heading.trim()));
      for (const p of s.paragraphs ?? []) {
        if (p?.trim()) out.push(this.textBlock('normal', p.trim()));
      }
      for (const b of s.blocks ?? []) {
        const node = this.customBlock(b);
        if (node) out.push(node);
      }
    }
    return out;
  }

  /**
   * 2º passo das imagens inline: gera (DALL·E via ImageGenerationService) as
   * imagens dos nodes que têm `_genPrompt`, troca por `url`. Cap de 2 por
   * artigo (custo). Best-effort: se uma falhar, o node é removido (sem buraco).
   */
  private async generateInlineImages(orgId: string, postId: string, body: PortableTextNode[]): Promise<void> {
    const MAX = 2;
    const pending = body.filter((n) => n._type === 'image' && typeof n._genPrompt === 'string');
    let done = 0;
    for (const node of pending) {
      if (done >= MAX) {
        this.removeNode(body, node);
        continue;
      }
      const prompt = node._genPrompt as string;
      try {
        const img = await this.images.generateAndUpload(
          orgId,
          {
            prompt,
            primaryColor: '#00E5FF',
            secondaryColor: '#09090b',
            width: 1200,
            height: 800,
          },
          `blog/${postId}/inline`,
        );
        node.url = img.url;
        delete node._genPrompt;
        done++;
      } catch (e) {
        this.log.warn(`imagem inline falhou (removendo node): ${(e as Error).message}`);
        this.removeNode(body, node);
      }
    }
  }

  /**
   * No publish: sobe as imagens inline (que hoje referenciam o storage do
   * Active via `url`) como assets do Sanity, pra ficarem duráveis + na CDN —
   * igual à capa. Best-effort: se o upload falhar, mantém o node por `url`
   * (o front renderiza os dois jeitos).
   */
  private async materializeBodyImages(body: PortableTextNode[]): Promise<PortableTextNode[]> {
    const out: PortableTextNode[] = [];
    for (const node of body) {
      if (node._type === 'image' && typeof node.url === 'string' && !node.asset) {
        try {
          const assetId = await this.sanity.uploadImageFromUrl(node.url as string);
          const clone: PortableTextNode = { ...node, asset: { _type: 'reference', _ref: assetId } };
          delete clone.url;
          delete clone._genPrompt;
          out.push(clone);
          continue;
        } catch (e) {
          this.log.warn(`upload imagem inline pro Sanity falhou (mantém url): ${(e as Error).message}`);
        }
      }
      out.push(node);
    }
    return out;
  }

  /** Remove placeholders de imagem (quando a geração de imagem está desligada). */
  private stripInlineImagePlaceholders(body: PortableTextNode[]): void {
    for (const node of body.filter((n) => n._type === 'image' && typeof n._genPrompt === 'string')) {
      this.removeNode(body, node);
    }
  }

  private removeNode(body: PortableTextNode[], node: PortableTextNode): void {
    const idx = body.indexOf(node);
    if (idx >= 0) body.splice(idx, 1);
  }

  private textBlock(style: string, text: string): PortableTextNode {
    return {
      _type: 'block',
      _key: this.k(),
      style,
      markDefs: [],
      children: [{ _type: 'span', _key: this.k(), text, marks: [] }],
    };
  }

  private customBlock(b: RawArticleBlock): PortableTextNode | null {
    const _key = this.k();
    switch (b.type) {
      case 'image':
        // Placeholder: a imagem é gerada num 2º passo (generateInlineImages),
        // que troca `_genPrompt` por `url`. O front renderiza via value.url.
        return b.prompt?.trim()
          ? { _type: 'image', _key, _genPrompt: b.prompt.trim(), alt: b.alt ?? '', caption: b.caption ?? undefined }
          : null;
      case 'stat':
        return b.value && b.label ? { _type: 'stat', _key, value: b.value, label: b.label, source: b.source } : null;
      case 'paperQuote':
        return b.quote
          ? { _type: 'paperQuote', _key, quote: b.quote, paperTitle: b.paperTitle, authors: b.authors, venue: b.venue, url: b.url }
          : null;
      case 'callout':
        return b.body ? { _type: 'callout', _key, variant: b.variant ?? 'info', title: b.title, body: b.body } : null;
      case 'comparison':
        return b.leftLabel && b.rightLabel && b.rows?.length
          ? {
              _type: 'comparison',
              _key,
              leftLabel: b.leftLabel,
              rightLabel: b.rightLabel,
              rows: b.rows.map((r) => ({ _type: 'comparisonRow', _key: this.k(), aspect: r.aspect, left: r.left, right: r.right })),
            }
          : null;
      default:
        return null;
    }
  }

  private slugify(s: string): string {
    return (s || 'post')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80);
  }

  private k(): string {
    return Math.random().toString(36).slice(2, 12);
  }

  private parseJson<T>(raw: string): T | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
    const candidate = fenced ? fenced[1] : trimmed;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      const m = /\{[\s\S]*\}/.exec(candidate);
      if (m) {
        try {
          return JSON.parse(m[0]) as T;
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}
