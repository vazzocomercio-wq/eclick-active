import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { LlmService } from '../../common/llm/llm.service';
import { ImageGenerationService } from '../social/image-generation/image-generation.service';
import { SanityBlogClient } from './sanity-blog.client';
import {
  BLOG_ARTICLE_SYSTEM_PROMPT,
  BLOG_PILLARS,
  buildArticleUserPrompt,
  fallbackCoverPrompt,
} from './blog-ai.prompts';
import type {
  BlogPostRow,
  GenerateBlogPostDto,
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
  ) {}

  private get db() {
    return this.supabase.adminClient;
  }

  // ── Geração ──────────────────────────────────────────────────────────

  async generateArticle(
    orgId: string,
    userId: string | null,
    dto: GenerateBlogPostDto,
  ): Promise<BlogPostRow> {
    if (!dto.topic?.trim()) throw new BadRequestException('Informe o tema/pauta.');
    const pillar = dto.pillar && VALID_PILLARS.has(dto.pillar) ? dto.pillar : DEFAULT_PILLAR;
    const t0 = Date.now();

    // 1) cria a linha em 'generating'
    const { data: created, error: insErr } = await this.db
      .from('blog_posts')
      .insert({
        org_id: orgId,
        created_by: userId,
        title: dto.topic.slice(0, 180),
        slug: `rascunho-${Date.now().toString(36)}`,
        status: 'generating',
        source_topic: dto.topic,
        pillar,
        category: pillar,
      })
      .select('id')
      .single();
    if (insErr) throw new BadRequestException(`blog_posts insert: ${insErr.message}`);
    const postId = (created as { id: string }).id;

    try {
      // 2) gera o artigo (JSON estruturado)
      const out = await this.llm.chat({
        orgId,
        feature: 'blog_article',
        system: BLOG_ARTICLE_SYSTEM_PROMPT,
        user: buildArticleUserPrompt({ topic: dto.topic, pillar, notes: dto.notes }),
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

      // 3) capa por IA (não bloqueia o artigo se falhar)
      let coverUrl: string | null = null;
      if (dto.generateCover !== false) {
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

      // 4) persiste tudo + status review
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

    const nowIso = new Date().toISOString();
    const pillar = row.pillar && VALID_PILLARS.has(row.pillar) ? row.pillar : DEFAULT_PILLAR;

    const doc: Record<string, unknown> & { _type: string; _id?: string } = {
      _type: 'post',
      _id: `blogpost-${row.id}`,
      title: row.title,
      slug: { _type: 'slug', current: row.slug },
      excerpt: row.excerpt ?? '',
      tldr: row.tldr ?? [],
      body: row.body ?? [],
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
    this.log.log(`[blog-ai] post ${id} publicado no Sanity (${sanityId})`);
    return data as BlogPostRow;
  }

  // ── helpers ──────────────────────────────────────────────────────────

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
