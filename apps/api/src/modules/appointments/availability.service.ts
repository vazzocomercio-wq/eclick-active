import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { AgentAvailability } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  AvailabilityDayDto,
  SetAvailabilityDto,
  SetDateOverrideDto,
} from './dto/availability.dto';

@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Lista regras de disponibilidade do agente (recorrentes + overrides). */
  async getAvailability(orgId: string, agentId: string): Promise<AgentAvailability[]> {
    const { data, error } = await this.supabase.adminClient
      .from('agent_availability')
      .select('*')
      .eq('org_id', orgId)
      .eq('agent_id', agentId)
      .order('day_of_week', { ascending: true });
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as AgentAvailability[];
  }

  /**
   * Substitui o schedule semanal recorrente do agente. Apaga TODAS as
   * regras com day_of_week IS NOT NULL (mantém overrides com specific_date).
   */
  async setAvailability(
    orgId: string,
    dto: SetAvailabilityDto,
  ): Promise<AgentAvailability[]> {
    // Apaga schedule semanal antigo
    const { error: delErr } = await this.supabase.adminClient
      .from('agent_availability')
      .delete()
      .eq('org_id', orgId)
      .eq('agent_id', dto.agent_id)
      .is('specific_date', null);
    if (delErr) throw new InternalServerErrorException(delErr.message);

    if (dto.schedule.length === 0) return [];

    const rows = dto.schedule.map((d: AvailabilityDayDto) => ({
      org_id: orgId,
      agent_id: dto.agent_id,
      day_of_week: d.day_of_week,
      start_time: d.start_time,
      end_time: d.end_time,
      is_available: d.is_available ?? true,
    }));

    const { data, error } = await this.supabase.adminClient
      .from('agent_availability')
      .insert(rows)
      .select('*');
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as AgentAvailability[];
  }

  /**
   * Override pra data específica (folga ou horário especial). Faz upsert
   * pelo (org_id, agent_id, specific_date).
   */
  async setDateOverride(
    orgId: string,
    dto: SetDateOverrideDto,
  ): Promise<AgentAvailability> {
    // Apaga override existente pra essa data
    await this.supabase.adminClient
      .from('agent_availability')
      .delete()
      .eq('org_id', orgId)
      .eq('agent_id', dto.agent_id)
      .eq('specific_date', dto.date);

    const { data, error } = await this.supabase.adminClient
      .from('agent_availability')
      .insert({
        org_id: orgId,
        agent_id: dto.agent_id,
        specific_date: dto.date,
        start_time: dto.start_time ?? '00:00',
        end_time: dto.end_time ?? '23:59',
        is_available: dto.is_available,
        day_of_week: null,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao salvar override');
    }
    return data as AgentAvailability;
  }
}
