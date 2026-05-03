import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Page,
  PageBlock,
  PagePublic,
  PageStatus,
  PageType,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreatePageDto, UpdatePageDto } from './dto/page.dto';
import { PageRendererService } from './page-renderer.service';

@Injectable()
export class PagesService {
  private readonly logger = new Logger(PagesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly renderer: PageRendererService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // CRUD admin
  // ──────────────────────────────────────────────────────────

  async list(
    orgId: string,
    filters: { page_type?: PageType; status?: PageStatus } = {},
  ): Promise<Page[]> {
    let q = this.supabase.adminClient
      .from('pages')
      .select('*')
      .eq('org_id', orgId)
      .neq('status', 'archived')
      .order('updated_at', { ascending: false });
    if (filters.page_type) q = q.eq('page_type', filters.page_type);
    if (filters.status) q = q.eq('status', filters.status);

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as Page[];
  }

  async findById(orgId: string, id: string): Promise<Page> {
    const { data, error } = await this.supabase.adminClient
      .from('pages')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Page ${id} não encontrada`);
    return data as Page;
  }

  async findActiveBySlug(slug: string): Promise<Page | null> {
    const { data, error } = await this.supabase.adminClient
      .from('pages')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();
    if (error) {
      this.logger.error(`findActiveBySlug erro: ${error.message}`);
      return null;
    }
    return (data as Page | null) ?? null;
  }

  async create(orgId: string, dto: CreatePageDto): Promise<Page> {
    const slug = dto.slug
      ? this.normalizeSlug(dto.slug)
      : await this.ensureUniqueSlug(orgId, this.generateSlug(dto.name));

    const { data, error } = await this.supabase.adminClient
      .from('pages')
      .insert({
        org_id: orgId,
        name: dto.name,
        slug,
        page_type: dto.page_type ?? 'landing',
        blocks: dto.blocks ?? [],
        global_styles: dto.global_styles ?? this.defaultStyles(),
        seo: dto.seo ?? {},
        settings: dto.settings ?? {},
        template_id: dto.template_id ?? null,
        ai_generated: dto.ai_generated ?? false,
        metadata: dto.metadata ?? {},
        status: 'draft',
      })
      .select('*')
      .maybeSingle();

    if (error) {
      if (error.message.includes('duplicate') || error.code === '23505') {
        throw new ConflictException('Slug já em uso nessa organização');
      }
      throw new InternalServerErrorException(error.message);
    }
    return data as Page;
  }

  async update(orgId: string, id: string, dto: UpdatePageDto): Promise<Page> {
    await this.findById(orgId, id);
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.slug !== undefined) patch.slug = this.normalizeSlug(dto.slug);
    if (dto.blocks !== undefined) patch.blocks = dto.blocks;
    if (dto.global_styles !== undefined) patch.global_styles = dto.global_styles;
    if (dto.seo !== undefined) patch.seo = dto.seo;
    if (dto.settings !== undefined) patch.settings = dto.settings;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.custom_domain !== undefined) patch.custom_domain = dto.custom_domain;

    const { data, error } = await this.supabase.adminClient
      .from('pages')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('Slug já em uso');
      }
      throw new InternalServerErrorException(error.message);
    }
    if (!data) throw new NotFoundException(`Page ${id} não encontrada`);
    return data as Page;
  }

  async delete(orgId: string, id: string): Promise<void> {
    // Soft delete: archived
    const { error } = await this.supabase.adminClient
      .from('pages')
      .update({ status: 'archived' })
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);
  }

  async publish(orgId: string, id: string): Promise<Page> {
    const page = await this.findById(orgId, id);
    // Compila HTML estático no momento do publish
    const html = await this.renderer.renderPage(page);
    const { data, error } = await this.supabase.adminClient
      .from('pages')
      .update({
        status: 'published',
        published_html: html,
        published_at: new Date().toISOString(),
        version: page.version + 1,
      })
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Page ${id}`);
    return data as Page;
  }

  async unpublish(orgId: string, id: string): Promise<Page> {
    const { data, error } = await this.supabase.adminClient
      .from('pages')
      .update({ status: 'paused' })
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Page ${id}`);
    return data as Page;
  }

  async duplicate(orgId: string, id: string): Promise<Page> {
    const page = await this.findById(orgId, id);
    const newSlug = await this.ensureUniqueSlug(orgId, `${page.slug}-copia`);
    return this.create(orgId, {
      name: `${page.name} (cópia)`,
      slug: newSlug,
      page_type: page.page_type,
      blocks: page.blocks.map((b) => ({ ...b, id: this.uuid() })),
      global_styles: page.global_styles,
      seo: page.seo,
      settings: page.settings,
      template_id: page.template_id ?? undefined,
    });
  }

  toPublic(page: Page): PagePublic {
    return {
      id: page.id,
      name: page.name,
      slug: page.slug,
      page_type: page.page_type,
      blocks: page.blocks,
      global_styles: page.global_styles,
      seo: page.seo,
      settings: page.settings,
    };
  }

  // ──────────────────────────────────────────────────────────
  // Block helpers — usados pelos endpoints de blocks
  // ──────────────────────────────────────────────────────────

  async appendBlock(orgId: string, pageId: string, block: PageBlock): Promise<Page> {
    const page = await this.findById(orgId, pageId);
    const blocks = [...page.blocks, { ...block, position: page.blocks.length }];
    return this.update(orgId, pageId, { blocks });
  }

  async updateBlock(
    orgId: string,
    pageId: string,
    blockId: string,
    contentPatch: Record<string, unknown>,
  ): Promise<Page> {
    const page = await this.findById(orgId, pageId);
    const blocks = page.blocks.map((b) =>
      b.id === blockId ? { ...b, content: { ...b.content, ...contentPatch } } : b,
    );
    return this.update(orgId, pageId, { blocks });
  }

  // ──────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || 'pagina';
  }

  private normalizeSlug(slug: string): string {
    return slug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 80);
  }

  private async ensureUniqueSlug(orgId: string, base: string): Promise<string> {
    let slug = base;
    let suffix = 2;
    while (await this.slugExists(orgId, slug)) {
      slug = `${base}-${suffix}`;
      suffix += 1;
      if (suffix > 999) throw new InternalServerErrorException('Não foi possível gerar slug único');
    }
    return slug;
  }

  private async slugExists(orgId: string, slug: string): Promise<boolean> {
    const { count, error } = await this.supabase.adminClient
      .from('pages')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('slug', slug);
    if (error) return false;
    return (count ?? 0) > 0;
  }

  private uuid(): string {
    return globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  private defaultStyles() {
    return {
      primary_color: '#00E5FF',
      secondary_color: '#0EA5E9',
      accent_color: '#22C55E',
      background: '#0A0A0F',
      text_color: '#F5F5F7',
      font_heading: 'Inter',
      font_body: 'Inter',
      border_radius: 8,
    };
  }

  // ──────────────────────────────────────────────────────────
  // Analytics
  // ──────────────────────────────────────────────────────────

  async getAnalytics(
    orgId: string,
    pageId: string,
    days = 30,
  ): Promise<{
    total_visits: number;
    unique_visitors: number;
    form_submissions: number;
    orders: number;
    revenue: number;
    conversion_rate: number;
    by_day: { date: string; visits: number; conversions: number }[];
    by_device: { device: string; count: number }[];
    by_source: { source: string; count: number }[];
    by_utm: { utm_source: string; utm_campaign: string; visits: number; conversions: number }[];
    avg_scroll_depth: number;
    avg_duration_seconds: number;
  }> {
    await this.findById(orgId, pageId);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

    const { data: visits, error } = await this.supabase.adminClient
      .from('page_visits')
      .select(
        'visitor_id, device, utm_source, utm_medium, utm_campaign, source, scroll_depth_pct, duration_seconds, form_submitted, order_completed, order_value, created_at',
      )
      .eq('page_id', pageId)
      .gte('created_at', since);
    if (error) throw new InternalServerErrorException(error.message);

    const rows = (visits ?? []) as Array<{
      visitor_id: string | null;
      device: string | null;
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      source: string | null;
      scroll_depth_pct: number | null;
      duration_seconds: number | null;
      form_submitted: boolean;
      order_completed: boolean;
      order_value: number | null;
      created_at: string;
    }>;

    const total_visits = rows.length;
    const unique_visitors = new Set(rows.map((r) => r.visitor_id).filter(Boolean)).size;
    const form_submissions = rows.filter((r) => r.form_submitted).length;
    const orders = rows.filter((r) => r.order_completed).length;
    const revenue = rows.reduce((sum, r) => sum + (r.order_value ?? 0), 0);
    const conversion_rate =
      total_visits > 0 ? ((form_submissions + orders) / total_visits) * 100 : 0;

    const avg = (vals: (number | null)[]) => {
      const filtered = vals.filter((v): v is number => v !== null);
      if (filtered.length === 0) return 0;
      return Math.round(filtered.reduce((s, v) => s + v, 0) / filtered.length);
    };

    // by_day
    const byDayMap = new Map<string, { visits: number; conversions: number }>();
    for (const r of rows) {
      const date = r.created_at.slice(0, 10);
      const cell = byDayMap.get(date) ?? { visits: 0, conversions: 0 };
      cell.visits += 1;
      if (r.form_submitted || r.order_completed) cell.conversions += 1;
      byDayMap.set(date, cell);
    }
    const by_day = Array.from(byDayMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // by_device
    const byDeviceMap = new Map<string, number>();
    for (const r of rows) {
      const k = r.device ?? 'unknown';
      byDeviceMap.set(k, (byDeviceMap.get(k) ?? 0) + 1);
    }
    const by_device = Array.from(byDeviceMap.entries()).map(([device, count]) => ({
      device,
      count,
    }));

    // by_source (referrer-based)
    const bySrcMap = new Map<string, number>();
    for (const r of rows) {
      const k = r.utm_source ?? r.source ?? 'direto';
      bySrcMap.set(k, (bySrcMap.get(k) ?? 0) + 1);
    }
    const by_source = Array.from(bySrcMap.entries()).map(([source, count]) => ({
      source,
      count,
    }));

    // by_utm
    const utmMap = new Map<string, { visits: number; conversions: number }>();
    for (const r of rows) {
      if (!r.utm_source) continue;
      const k = `${r.utm_source}::${r.utm_campaign ?? '-'}`;
      const cell = utmMap.get(k) ?? { visits: 0, conversions: 0 };
      cell.visits += 1;
      if (r.form_submitted || r.order_completed) cell.conversions += 1;
      utmMap.set(k, cell);
    }
    const by_utm = Array.from(utmMap.entries()).map(([k, v]) => {
      const [utm_source, utm_campaign] = k.split('::');
      return { utm_source: utm_source ?? '', utm_campaign: utm_campaign ?? '', ...v };
    });

    return {
      total_visits,
      unique_visitors,
      form_submissions,
      orders,
      revenue,
      conversion_rate: Math.round(conversion_rate * 10) / 10,
      by_day,
      by_device,
      by_source,
      by_utm,
      avg_scroll_depth: avg(rows.map((r) => r.scroll_depth_pct)),
      avg_duration_seconds: avg(rows.map((r) => r.duration_seconds)),
    };
  }
}
