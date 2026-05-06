import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import type { SocialCalendar } from './social.types';
import type {
  CreateCalendarDto,
  UpdateCalendarDto,
} from './dto/calendar.dto';

@Injectable()
export class SocialCalendarsService {
  private readonly log = new Logger(SocialCalendarsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async create(orgId: string, dto: CreateCalendarDto): Promise<SocialCalendar> {
    if (!dto.name?.trim() || !dto.brand_id) {
      throw new BadRequestException('name e brand_id são obrigatórios');
    }
    const { data, error } = await this.supabase.adminClient
      .from('social_calendars')
      .insert({ ...dto, org_id: orgId })
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialCalendar;
  }

  async findAll(
    orgId: string,
    filters: { brand_id?: string; status?: string } = {},
  ): Promise<SocialCalendar[]> {
    let q = this.supabase.adminClient
      .from('social_calendars')
      .select('*')
      .eq('org_id', orgId)
      .order('start_date', { ascending: false });
    if (filters.brand_id) q = q.eq('brand_id', filters.brand_id);
    if (filters.status) q = q.eq('status', filters.status);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as SocialCalendar[];
  }

  async findById(orgId: string, id: string): Promise<SocialCalendar> {
    const { data, error } = await this.supabase.adminClient
      .from('social_calendars')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Calendário não encontrado');
    return data as SocialCalendar;
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateCalendarDto,
  ): Promise<SocialCalendar> {
    const { data, error } = await this.supabase.adminClient
      .from('social_calendars')
      .update(dto)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialCalendar;
  }

  async delete(orgId: string, id: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('social_calendars')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);
    if (error) throw error;
  }
}
