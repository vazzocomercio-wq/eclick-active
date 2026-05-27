import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { asUuidOrNull } from '../../common/uuid.util';
import type {
  SocialContent,
  ContentStatus,
  DashboardCounts,
} from './social.types';
import type {
  CreateContentDto,
  UpdateContentDto,
  ScheduleContentDto,
  RejectContentDto,
} from './dto/content.dto';

@Injectable()
export class SocialContentsService {
  private readonly log = new Logger(SocialContentsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async create(orgId: string, dto: CreateContentDto): Promise<SocialContent> {
    if (!dto.brand_id || !dto.content_type) {
      throw new BadRequestException('brand_id e content_type são obrigatórios');
    }
    const { data, error } = await this.supabase.adminClient
      .from('social_contents')
      .insert({ ...dto, org_id: orgId })
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialContent;
  }

  async findAll(
    orgId: string,
    filters: {
      status?: ContentStatus | ContentStatus[];
      content_type?: string;
      brand_id?: string;
      calendar_id?: string;
      pillar?: string;
      search?: string;
      page?: number;
      page_size?: number;
    } = {},
  ): Promise<{ rows: SocialContent[]; total: number }> {
    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.page_size ?? 25, 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = this.supabase.adminClient
      .from('social_contents')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId);

    if (filters.status) {
      const arr = Array.isArray(filters.status) ? filters.status : [filters.status];
      q = q.in('status', arr);
    }
    if (filters.content_type) q = q.eq('content_type', filters.content_type);
    if (filters.brand_id) q = q.eq('brand_id', filters.brand_id);
    if (filters.calendar_id) q = q.eq('calendar_id', filters.calendar_id);
    if (filters.pillar) q = q.eq('pillar', filters.pillar);
    if (filters.search?.trim()) {
      q = q.or(`title.ilike.%${filters.search}%,caption.ilike.%${filters.search}%`);
    }

    q = q
      .order('created_at', { ascending: false })
      .range(from, to);

    const { data, error, count } = await q;
    if (error) throw error;
    return { rows: (data ?? []) as SocialContent[], total: count ?? 0 };
  }

  async findById(orgId: string, id: string): Promise<SocialContent> {
    const { data, error } = await this.supabase.adminClient
      .from('social_contents')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Conteúdo não encontrado');
    return data as SocialContent;
  }

  async findVersions(
    orgId: string,
    contentId: string,
  ): Promise<SocialContent[]> {
    const root = await this.findById(orgId, contentId);
    const { data } = await this.supabase.adminClient
      .from('social_contents')
      .select('*')
      .eq('org_id', orgId)
      .or(`id.eq.${root.id},parent_content_id.eq.${root.parent_content_id ?? root.id}`)
      .order('version', { ascending: true });
    return (data ?? []) as SocialContent[];
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateContentDto,
  ): Promise<SocialContent> {
    // related_product_id é uuid; refs não-uuid (ex.: id de produto TikTok Shop)
    // viram null — a foto/legenda já vêm no próprio PATCH (cover/media).
    const patch =
      'related_product_id' in dto
        ? { ...dto, related_product_id: asUuidOrNull((dto as { related_product_id?: string | null }).related_product_id) }
        : dto;
    const { data, error } = await this.supabase.adminClient
      .from('social_contents')
      .update(patch)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialContent;
  }

  async approve(
    orgId: string,
    id: string,
    actorId: string | null,
  ): Promise<SocialContent> {
    const current = await this.findById(orgId, id);
    const nextStatus: ContentStatus = current.scheduled_for ? 'scheduled' : 'approved';
    return this.update(orgId, id, {
      status: nextStatus,
    }).then(async (c) => {
      // Atualiza approved_by/approved_at separado pq UpdateContentDto não tem esses campos
      await this.supabase.adminClient
        .from('social_contents')
        .update({
          approved_by: actorId,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('org_id', orgId);
      return c;
    });
  }

  async reject(
    orgId: string,
    id: string,
    dto: RejectContentDto,
  ): Promise<SocialContent> {
    return this.update(orgId, id, {
      status: 'rejected',
    }).then(async (c) => {
      if (dto.reason) {
        await this.supabase.adminClient
          .from('social_contents')
          .update({ rejection_reason: dto.reason })
          .eq('id', id);
      }
      return c;
    });
  }

  async schedule(
    orgId: string,
    id: string,
    dto: ScheduleContentDto,
  ): Promise<SocialContent> {
    if (!dto.scheduled_for) {
      throw new BadRequestException('scheduled_for obrigatório');
    }
    return this.update(orgId, id, {
      scheduled_for: dto.scheduled_for,
      scheduled_channels: dto.channels ?? null,
      status: 'scheduled',
    });
  }

  async unschedule(orgId: string, id: string): Promise<SocialContent> {
    return this.update(orgId, id, {
      scheduled_for: null,
      scheduled_channels: null,
      status: 'approved',
    });
  }

  async duplicate(orgId: string, id: string): Promise<SocialContent> {
    const orig = await this.findById(orgId, id);
    const { data, error } = await this.supabase.adminClient
      .from('social_contents')
      .insert({
        org_id: orgId,
        brand_id: orig.brand_id,
        calendar_id: orig.calendar_id,
        content_type: orig.content_type,
        format_subtype: orig.format_subtype,
        title: orig.title ? `${orig.title} (cópia)` : 'Cópia',
        caption: orig.caption,
        hashtags: orig.hashtags,
        cta: orig.cta,
        media: orig.media,
        slides: orig.slides,
        cover_image_url: orig.cover_image_url,
        channels: orig.channels,
        pillar: orig.pillar,
        campaign_tag: orig.campaign_tag,
        status: 'draft',
        version: 1,
        metadata: orig.metadata,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialContent;
  }

  async delete(orgId: string, id: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('social_contents')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);
    if (error) throw error;
  }

  async getDashboard(orgId: string): Promise<DashboardCounts> {
    try {
      // Pega counts em uma única query agregada
      const { data } = await this.supabase.adminClient
        .from('social_contents')
        .select('status, pillar, scheduled_for, published_at')
        .eq('org_id', orgId)
        .limit(2000);
      const rows = (data ?? []) as Array<{
        status: string;
        pillar: string | null;
        scheduled_for: string | null;
        published_at: string | null;
      }>;

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const next7d = new Date(Date.now() + 7 * 86_400_000);

      const counts: DashboardCounts = {
        pending_approval: rows.filter((r) => r.status === 'pending_approval').length,
        scheduled_next_7d: rows.filter(
          (r) =>
            r.status === 'scheduled' &&
            r.scheduled_for &&
            new Date(r.scheduled_for) <= next7d,
        ).length,
        drafts: rows.filter((r) => r.status === 'draft').length,
        published_this_month: rows.filter(
          (r) => r.published_at && new Date(r.published_at) >= monthStart,
        ).length,
        by_pillar: {},
        by_status: {},
      };
      for (const r of rows) {
        if (r.pillar) {
          counts.by_pillar[r.pillar] = (counts.by_pillar[r.pillar] ?? 0) + 1;
        }
        counts.by_status[r.status] = (counts.by_status[r.status] ?? 0) + 1;
      }
      return counts;
    } catch (err) {
      this.log.warn(`getDashboard falhou: ${String(err)}`);
      return {
        pending_approval: 0,
        scheduled_next_7d: 0,
        drafts: 0,
        published_this_month: 0,
        by_pillar: {},
        by_status: {},
      };
    }
  }
}
