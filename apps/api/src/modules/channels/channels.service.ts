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

export interface WhatsAppFreeDiagnostics {
  /** Canais whatsapp_free dessa org (sem segredos) */
  channels: Array<{
    id: string;
    name: string;
    status: ChannelStatus;
    has_credentials: boolean;
    phone_number: string | null;
    error_message: string | null;
    created_at: string;
    age_seconds: number;
  }>;
  /** Presença das envs críticas no servidor api (true se não-vazia) */
  api_envs: {
    INTERNAL_API_KEY: boolean;
    SUPABASE_URL: boolean;
    SUPABASE_SERVICE_ROLE_KEY: boolean;
  };
  /** Quantos canais estão pendurados em pending sem auth */
  pending_count: number;
  /** Hint humano sobre o estado provável */
  hint: string;
}

const SAFE_COLUMNS =
  'id, org_id, channel_type, name, status, phone_number, external_id, webhook_url, last_webhook_at, error_message, config, credentials, created_at, updated_at';

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getWhatsAppFreeDiagnostics(orgId: string): Promise<WhatsAppFreeDiagnostics> {
    const { data, error } = await this.supabase.adminClient
      .from('channels')
      .select(
        'id, name, status, phone_number, error_message, credentials, created_at',
      )
      .eq('org_id', orgId)
      .eq('channel_type', 'whatsapp_free')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`diagnostics failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    const now = Date.now();
    const rows = (data ?? []) as Array<{
      id: string;
      name: string;
      status: ChannelStatus;
      phone_number: string | null;
      error_message: string | null;
      credentials: Record<string, unknown> | null;
      created_at: string;
    }>;

    const channels = rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      has_credentials: Boolean(
        r.credentials && Object.keys(r.credentials).length > 0,
      ),
      phone_number: r.phone_number,
      error_message: r.error_message,
      created_at: r.created_at,
      age_seconds: Math.floor((now - new Date(r.created_at).getTime()) / 1000),
    }));

    const pending_count = channels.filter((c) => c.status === 'pending').length;

    const api_envs = {
      INTERNAL_API_KEY: Boolean(process.env.INTERNAL_API_KEY),
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    };

    let hint = 'Sem dados.';
    if (channels.length === 0) {
      hint = 'Nenhum canal whatsapp_free cadastrado nessa org.';
    } else if (pending_count === 0) {
      const active = channels.filter((c) => c.status === 'active').length;
      hint = `Sem canais pending. ${active} ativo(s).`;
    } else {
      const oldest = channels
        .filter((c) => c.status === 'pending')
        .reduce((max, c) => (c.age_seconds > max ? c.age_seconds : max), 0);
      if (oldest > 30) {
        hint =
          `${pending_count} canal(is) pending há ${oldest}s. Worker deveria ter pego em ≤3s. ` +
          'Provavelmente o serviço workers não está rodando, não conectou no Supabase ou não consegue chamar /internal/realtime.';
      } else {
        hint = `${pending_count} canal(is) pending há ${oldest}s — aguardando worker (até 3s normal).`;
      }
    }

    return { channels, api_envs, pending_count, hint };
  }

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
