import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AIFeatureName,
  OrgMemberRole,
  Plan,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { invalidateOrgTimezoneCache } from '../../common/org-settings.helper';
import { UpdateAiFeatureDto, UpdateOrgDto } from './dto/settings.dto';

export interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
  trial_ends_at: string | null;
  max_users: number;
  max_channels: number;
  max_pipelines: number;
  max_automations: number;
  has_copilot: boolean;
  has_audit: boolean;
  has_erp_integration: boolean;
  member_count: number;
  channel_count: number;
  /** Configurações livres da org (jsonb) — auto_create_deal, etc. */
  settings: Record<string, unknown>;
}

export interface AiFeature {
  id: string;
  feature_name: AIFeatureName;
  provider: string;
  model: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updated_at: string;
}

const DEFAULT_FEATURES: AIFeatureName[] = [
  'auto_classify',
  'suggest_response',
  'auto_respond',
  'summarize',
  'sentiment',
  'lead_scoring',
  'copilot',
  'audit',
  'follow_up_agent',
  'train_agent',
];

/**
 * Settings da organização + features de IA. Custom field definitions
 * vivem em src/modules/custom-fields/ (módulo separado a partir da PARTE 9
 * do refactor de drawers).
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ────────────────────────────────────────────
  // ORG
  // ────────────────────────────────────────────

  async getOrg(orgId: string): Promise<OrgSettings> {
    const { data: org, error } = await this.supabase.adminClient
      .from('organizations')
      .select(
        'id, name, slug, plan, trial_ends_at, max_users, max_channels, max_pipelines, max_automations, has_copilot, has_audit, has_erp_integration, settings',
      )
      .eq('id', orgId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!org) throw new NotFoundException(`Org ${orgId} not found`);

    const [memberResp, channelResp] = await Promise.all([
      this.supabase.adminClient
        .from('org_members')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .neq('status', 'suspended'),
      this.supabase.adminClient
        .from('channels')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .neq('status', 'disconnected'),
    ]);

    const orgRow = org as Omit<OrgSettings, 'member_count' | 'channel_count'> & {
      settings: Record<string, unknown> | null;
    };
    return {
      ...orgRow,
      settings: orgRow.settings ?? {},
      member_count: memberResp.count ?? 0,
      channel_count: channelResp.count ?? 0,
    };
  }

  async updateOrg(
    orgId: string,
    actorRole: OrgMemberRole,
    dto: UpdateOrgDto,
  ): Promise<OrgSettings> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException(
        'Apenas owner/admin podem editar a organização.',
      );
    }

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.slug !== undefined) patch.slug = dto.slug.trim();

    // Settings — merge raso com o jsonb existente. Frontend envia só as
    // keys que mudou; manteremos as outras intactas.
    if (dto.settings !== undefined) {
      const { data: existing } = await this.supabase.adminClient
        .from('organizations')
        .select('settings')
        .eq('id', orgId)
        .maybeSingle();
      const current = ((existing as { settings: Record<string, unknown> } | null)?.settings ??
        {}) as Record<string, unknown>;
      patch.settings = { ...current, ...dto.settings };

      // Invalida cache de timezone quando muda — caso contrário formatadores
      // continuariam usando o tz antigo até expirar (5min).
      if ('timezone' in dto.settings && dto.settings.timezone !== current.timezone) {
        invalidateOrgTimezoneCache(orgId);
      }
    }

    if (Object.keys(patch).length === 0) {
      return this.getOrg(orgId);
    }

    const { error } = await this.supabase.adminClient
      .from('organizations')
      .update(patch)
      .eq('id', orgId);

    if (error) {
      // Provável colisão de slug (UNIQUE)
      if (error.message.toLowerCase().includes('duplicate')) {
        throw new ConflictException('Esse slug já está em uso por outra organização.');
      }
      throw new InternalServerErrorException(error.message);
    }
    return this.getOrg(orgId);
  }

  // ────────────────────────────────────────────
  // AI FEATURES
  // ────────────────────────────────────────────

  async getAiFeatures(orgId: string): Promise<AiFeature[]> {
    const { data, error } = await this.supabase.adminClient
      .from('ai_feature_settings')
      .select('id, feature_name, provider, model, enabled, config, updated_at')
      .eq('org_id', orgId);

    if (error) {
      this.logger.error(`getAiFeatures failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    const existing = ((data ?? []) as AiFeature[]).reduce<Map<string, AiFeature>>(
      (acc, f) => {
        acc.set(f.feature_name, f);
        return acc;
      },
      new Map(),
    );

    return DEFAULT_FEATURES.map((name) => {
      const f = existing.get(name);
      if (f) return f;
      return {
        id: `virtual:${name}`,
        feature_name: name,
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        enabled: true,
        config: {},
        updated_at: new Date(0).toISOString(),
      };
    });
  }

  async upsertAiFeature(
    orgId: string,
    actorRole: OrgMemberRole,
    featureName: AIFeatureName,
    dto: UpdateAiFeatureDto,
  ): Promise<AiFeature> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException(
        'Apenas owner/admin podem alterar features de IA.',
      );
    }

    const payload = {
      org_id: orgId,
      feature_name: featureName,
      provider: dto.provider ?? 'anthropic',
      model: dto.model ?? 'claude-haiku-4-5',
      enabled: dto.enabled ?? true,
      config: dto.config ?? {},
    };

    const { data, error } = await this.supabase.adminClient
      .from('ai_feature_settings')
      .upsert(payload, { onConflict: 'org_id,feature_name' })
      .select('id, feature_name, provider, model, enabled, config, updated_at')
      .single();

    if (error || !data) {
      this.logger.error(`upsertAiFeature failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to update AI feature',
      );
    }
    return data as AiFeature;
  }
}
