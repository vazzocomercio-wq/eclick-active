import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Form,
  FormField,
  FormPublic,
  FormSubmission,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateFormDto, UpdateFormDto } from './dto/form.dto';

@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ──────────────────────────────────────────────────────────
  // CRUD admin
  // ──────────────────────────────────────────────────────────

  async list(orgId: string): Promise<Form[]> {
    const { data, error } = await this.supabase.adminClient
      .from('forms')
      .select('*')
      .eq('org_id', orgId)
      .neq('status', 'archived')
      .order('created_at', { ascending: false });
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as Form[];
  }

  async findById(orgId: string, id: string): Promise<Form> {
    const { data, error } = await this.supabase.adminClient
      .from('forms')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Form ${id} não encontrado`);
    return data as Form;
  }

  async create(orgId: string, dto: CreateFormDto): Promise<Form> {
    const slug = dto.slug ?? this.generateSlug(dto.name);
    const finalSlug = await this.ensureUniqueSlug(orgId, slug);

    const { data, error } = await this.supabase.adminClient
      .from('forms')
      .insert({
        org_id: orgId,
        name: dto.name,
        slug: finalSlug,
        description: dto.description ?? null,
        fields: dto.fields ?? [],
        settings: dto.settings ?? {},
        branding: dto.branding ?? {},
        status: dto.status ?? 'draft',
        template_category: dto.template_category ?? null,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao criar form');
    }
    return data as Form;
  }

  async update(orgId: string, id: string, dto: UpdateFormDto): Promise<Form> {
    await this.findById(orgId, id);

    const patch: Record<string, unknown> = {};
    for (const k of [
      'name',
      'description',
      'fields',
      'settings',
      'branding',
      'status',
    ] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }

    if (dto.slug) {
      const slug = await this.ensureUniqueSlug(orgId, dto.slug, id);
      patch.slug = slug;
    }

    const { data, error } = await this.supabase.adminClient
      .from('forms')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao atualizar');
    }
    return data as Form;
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.findById(orgId, id);
    const { error } = await this.supabase.adminClient
      .from('forms')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);
  }

  async publish(orgId: string, id: string): Promise<Form> {
    return this.update(orgId, id, { status: 'active' });
  }

  async pause(orgId: string, id: string): Promise<Form> {
    return this.update(orgId, id, { status: 'paused' });
  }

  async duplicate(orgId: string, id: string): Promise<Form> {
    const original = await this.findById(orgId, id);
    const newSlug = await this.ensureUniqueSlug(orgId, `${original.slug}-copia`);
    return this.create(orgId, {
      name: `${original.name} (cópia)`,
      slug: newSlug,
      description: original.description ?? undefined,
      fields: original.fields as unknown[],
      settings: original.settings as unknown as Record<string, unknown>,
      branding: original.branding as unknown as Record<string, unknown>,
      status: 'draft',
    });
  }

  // ──────────────────────────────────────────────────────────
  // Public — sem AuthGuard
  // ──────────────────────────────────────────────────────────

  async findActiveBySlug(slug: string): Promise<Form | null> {
    const { data, error } = await this.supabase.adminClient
      .from('forms')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'active')
      .maybeSingle();
    if (error) {
      this.logger.warn(`findActiveBySlug falhou: ${error.message}`);
      return null;
    }
    return (data as Form | null) ?? null;
  }

  toPublic(form: Form): FormPublic {
    return {
      id: form.id,
      name: form.name,
      slug: form.slug,
      description: form.description,
      fields: form.fields as FormField[],
      branding: form.branding,
      success_message: form.settings.success_message ?? null,
      redirect_url: form.settings.redirect_url ?? null,
    };
  }

  // ──────────────────────────────────────────────────────────
  // Submissions
  // ──────────────────────────────────────────────────────────

  async getSubmissions(
    orgId: string,
    formId: string,
    opts: { page?: number; limit?: number } = {},
  ): Promise<{ data: FormSubmission[]; total: number }> {
    const page = opts.page ?? 1;
    const limit = Math.min(opts.limit ?? 50, 200);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await this.supabase.adminClient
      .from('form_submissions')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .eq('form_id', formId)
      .order('submitted_at', { ascending: false })
      .range(from, to);
    if (error) throw new InternalServerErrorException(error.message);
    return { data: (data ?? []) as FormSubmission[], total: count ?? 0 };
  }

  async getAnalytics(
    orgId: string,
    formId: string,
  ): Promise<{
    total: number;
    by_day: Array<{ day: string; count: number }>;
    by_source: Array<{ source: string; count: number }>;
    by_utm_source: Array<{ utm_source: string; count: number }>;
  }> {
    const { data, error } = await this.supabase.adminClient
      .from('form_submissions')
      .select('source, utm_source, submitted_at')
      .eq('org_id', orgId)
      .eq('form_id', formId)
      .gte('submitted_at', new Date(Date.now() - 90 * 86400_000).toISOString())
      .order('submitted_at', { ascending: false });
    if (error) throw new InternalServerErrorException(error.message);

    const rows = (data ?? []) as Array<{
      source: string;
      utm_source: string | null;
      submitted_at: string;
    }>;

    const byDayMap = new Map<string, number>();
    const bySourceMap = new Map<string, number>();
    const byUtmMap = new Map<string, number>();
    for (const r of rows) {
      const day = r.submitted_at.slice(0, 10);
      byDayMap.set(day, (byDayMap.get(day) ?? 0) + 1);
      bySourceMap.set(r.source, (bySourceMap.get(r.source) ?? 0) + 1);
      const utm = r.utm_source ?? 'direct';
      byUtmMap.set(utm, (byUtmMap.get(utm) ?? 0) + 1);
    }

    return {
      total: rows.length,
      by_day: Array.from(byDayMap.entries())
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      by_source: Array.from(bySourceMap.entries()).map(([source, count]) => ({ source, count })),
      by_utm_source: Array.from(byUtmMap.entries()).map(([utm_source, count]) => ({
        utm_source,
        count,
      })),
    };
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  generateSlug(name: string): string {
    return name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'form';
  }

  private async ensureUniqueSlug(orgId: string, baseSlug: string, excludeId?: string): Promise<string> {
    let candidate = baseSlug;
    let suffix = 1;
    while (true) {
      let q = this.supabase.adminClient
        .from('forms')
        .select('id')
        .eq('org_id', orgId)
        .eq('slug', candidate)
        .limit(1);
      if (excludeId) q = q.neq('id', excludeId);
      const { data } = await q.maybeSingle();
      if (!data) return candidate;
      suffix += 1;
      candidate = `${baseSlug}-${suffix}`;
      if (suffix > 50) {
        throw new ConflictException('Não foi possível gerar slug único');
      }
    }
  }
}
