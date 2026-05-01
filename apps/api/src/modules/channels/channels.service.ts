import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ChannelStatus, ChannelType } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  CreateChannelDto,
  UpdateChannelDto,
} from './dto/create-channel.dto';

export interface ChannelView {
  id: string;
  org_id: string;
  channel_type: ChannelType;
  name: string;
  status: ChannelStatus;
  phone_number: string | null;
  external_id: string | null;
  webhook_url: string | null;
  last_webhook_at: string | null;
  error_message: string | null;
  config: Record<string, unknown>;
  /** credentials NUNCA são retornadas — segredos. Indicador booleano. */
  has_credentials: boolean;
  created_at: string;
  updated_at: string;
}

const SAFE_COLUMNS =
  'id, org_id, channel_type, name, status, phone_number, external_id, webhook_url, last_webhook_at, error_message, config, credentials, created_at, updated_at';

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string): Promise<ChannelView[]> {
    const { data, error } = await this.supabase.adminClient
      .from('channels')
      .select(SAFE_COLUMNS)
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error(`list failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return (data ?? []).map((row) => this.toView(row as unknown as ChannelRow));
  }

  async findById(orgId: string, id: string): Promise<ChannelView> {
    const { data, error } = await this.supabase.adminClient
      .from('channels')
      .select(SAFE_COLUMNS)
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Channel ${id} not found`);
    return this.toView(data as unknown as ChannelRow);
  }

  async create(orgId: string, dto: CreateChannelDto): Promise<ChannelView> {
    await this.assertWithinPlanLimit(orgId);

    const { data, error } = await this.supabase.adminClient
      .from('channels')
      .insert({
        org_id: orgId,
        channel_type: dto.channel_type,
        name: dto.name,
        credentials: dto.credentials ?? {},
        phone_number: dto.phone_number ?? null,
        external_id: dto.external_id ?? null,
        config: dto.config ?? {},
        status: dto.credentials ? 'active' : 'pending',
      })
      .select(SAFE_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`create channel failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to create channel',
      );
    }
    return this.toView(data as unknown as ChannelRow);
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateChannelDto,
  ): Promise<ChannelView> {
    await this.findById(orgId, id);

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.credentials !== undefined) patch.credentials = dto.credentials;
    if (dto.phone_number !== undefined) patch.phone_number = dto.phone_number;
    if (dto.config !== undefined) patch.config = dto.config;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.paused !== undefined) {
      patch.status = dto.paused ? 'paused' : 'active';
    }

    const { data, error } = await this.supabase.adminClient
      .from('channels')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select(SAFE_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`update channel failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to update channel',
      );
    }
    return this.toView(data as unknown as ChannelRow);
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.findById(orgId, id);
    const { error } = await this.supabase.adminClient
      .from('channels')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);
  }

  // ────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────

  private toView(row: ChannelRow): ChannelView {
    const { credentials, ...rest } = row;
    return {
      ...rest,
      has_credentials: Object.keys(credentials ?? {}).length > 0,
    };
  }

  private async assertWithinPlanLimit(orgId: string): Promise<void> {
    const { data: org } = await this.supabase.adminClient
      .from('organizations')
      .select('max_channels')
      .eq('id', orgId)
      .maybeSingle();

    const maxChannels = (org as { max_channels: number } | null)?.max_channels ?? 1;

    const { count } = await this.supabase.adminClient
      .from('channels')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .neq('status', 'disconnected');

    if ((count ?? 0) >= maxChannels) {
      throw new ConflictException(
        `Limite de ${maxChannels} canais do plano atingido. Faça upgrade pra adicionar mais.`,
      );
    }
  }
}

interface ChannelRow {
  id: string;
  org_id: string;
  channel_type: ChannelType;
  name: string;
  status: ChannelStatus;
  phone_number: string | null;
  external_id: string | null;
  webhook_url: string | null;
  last_webhook_at: string | null;
  error_message: string | null;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
