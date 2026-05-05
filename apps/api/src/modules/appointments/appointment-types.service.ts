import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AppointmentType } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  CreateAppointmentTypeDto,
  UpdateAppointmentTypeDto,
} from './dto/appointment-type.dto';

const DEFAULT_TYPES: CreateAppointmentTypeDto[] = [
  {
    name: 'Reunião online',
    description: 'Videoconferência (Google Meet, Zoom, etc.)',
    duration_minutes: 30,
    location_type: 'online',
    color: '#00E5FF',
    buffer_minutes: 15,
  },
  {
    name: 'Ligação',
    description: 'Contato telefônico rápido',
    duration_minutes: 15,
    location_type: 'telefone',
    color: '#10B981',
    buffer_minutes: 5,
  },
  {
    name: 'Visita presencial',
    description: 'Encontro presencial no endereço acordado',
    duration_minutes: 60,
    location_type: 'presencial',
    color: '#F59E0B',
    buffer_minutes: 30,
  },
];

@Injectable()
export class AppointmentTypesService {
  private readonly logger = new Logger(AppointmentTypesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string, includeInactive = false): Promise<AppointmentType[]> {
    let q = this.supabase.adminClient
      .from('appointment_types')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as AppointmentType[];
  }

  async findById(orgId: string, id: string): Promise<AppointmentType> {
    const { data, error } = await this.supabase.adminClient
      .from('appointment_types')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Tipo ${id} não encontrado`);
    return data as AppointmentType;
  }

  async create(orgId: string, dto: CreateAppointmentTypeDto): Promise<AppointmentType> {
    const { data, error } = await this.supabase.adminClient
      .from('appointment_types')
      .insert({
        org_id: orgId,
        name: dto.name,
        description: dto.description ?? null,
        duration_minutes: dto.duration_minutes ?? 30,
        location_type: dto.location_type ?? 'online',
        location_details: dto.location_details ?? null,
        color: dto.color ?? '#00E5FF',
        buffer_minutes: dto.buffer_minutes ?? 15,
        min_advance_hours: dto.min_advance_hours ?? 2,
        max_per_day: dto.max_per_day ?? 10,
        is_active: dto.is_active ?? true,
        metadata: dto.metadata ?? {},
        custom_fields_schema: dto.custom_fields_schema ?? [],
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao criar tipo');
    }
    return data as AppointmentType;
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateAppointmentTypeDto,
  ): Promise<AppointmentType> {
    await this.findById(orgId, id);
    const patch: Record<string, unknown> = {};
    for (const k of [
      'name',
      'description',
      'duration_minutes',
      'location_type',
      'location_details',
      'color',
      'buffer_minutes',
      'min_advance_hours',
      'max_per_day',
      'is_active',
      'metadata',
      'custom_fields_schema',
    ] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    const { data, error } = await this.supabase.adminClient
      .from('appointment_types')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao atualizar');
    }
    return data as AppointmentType;
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.findById(orgId, id);
    const { error } = await this.supabase.adminClient
      .from('appointment_types')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);
  }

  /**
   * Cria os 3 tipos default (Reunião online / Ligação / Visita presencial)
   * pra uma org nova. Idempotente — não duplica se já existem.
   */
  async seedDefaultTypes(orgId: string): Promise<void> {
    const existing = await this.list(orgId, true);
    if (existing.length > 0) return;
    for (const t of DEFAULT_TYPES) {
      await this.create(orgId, t);
    }
    this.logger.log(`Seeded ${DEFAULT_TYPES.length} default appointment types for org ${orgId}`);
  }
}
