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
import { LlmService } from '../../common/llm/llm.service';
import {
  LLM_CATALOG,
  LLM_DEFAULT_MODEL,
  LlmProviderName,
} from '../../common/llm/llm-provider.interface';
import { encryptApiKey, lastFour } from '../../common/llm/crypto.util';
import { BadRequestException } from '@nestjs/common';
import {
  UpdateAiBudgetDto,
  UpdateAiFeatureDto,
  UpdateLlmCredentialsDto,
  UpdateOrgDto,
} from './dto/settings.dto';

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

export interface LlmCredentials {
  configured: boolean;
  provider: LlmProviderName;
  model: string;
  api_key_last4: string | null;
  /** Chave OpenAI dedicada (Whisper/embeddings/DALL·E) configurada? */
  openai_configured: boolean;
  openai_api_key_last4: string | null;
  /** Modo BYOK da org. 'own' = exige chave própria; 'platform' = chave do servidor. */
  ai_keys_mode: 'platform' | 'own';
  available_providers: LlmProviderName[];
  available_models: Record<LlmProviderName, readonly string[]>;
  updated_at: string | null;
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

export interface AiBudget {
  configured: boolean;
  monthly_budget_usd: number | null;
  alert_threshold_pct: number;
  hard_cap: boolean;
  updated_at: string | null;
}

export interface AiUsageBreakdownRow {
  key: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  usd: number;
}

export interface AiUsageSummary {
  /** Início do mês em UTC ISO. */
  period_start: string;
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_usd: number;
  by_feature: AiUsageBreakdownRow[];
  by_model: AiUsageBreakdownRow[];
  budget: AiBudget;
  /** % usado do budget. 0 quando budget não configurado. */
  pct_used: number;
}

export interface AiUsageTimelinePoint {
  date: string; // YYYY-MM-DD
  calls: number;
  usd: number;
}

export interface AiUsageTimeline {
  days: number;
  series: AiUsageTimelinePoint[];
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

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
  ) {}

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

  // ────────────────────────────────────────────
  // LLM CREDENTIALS (org_llm_credentials)
  // ────────────────────────────────────────────

  async getLlmCredentials(orgId: string): Promise<LlmCredentials> {
    const [{ data, error }, { data: orgData }] = await Promise.all([
      this.supabase.adminClient
        .from('org_llm_credentials')
        .select('provider, model_default, api_key_last4, openai_api_key_last4, updated_at')
        .eq('org_id', orgId)
        .maybeSingle(),
      this.supabase.adminClient
        .from('organizations')
        .select('ai_keys_mode')
        .eq('id', orgId)
        .maybeSingle(),
    ]);

    if (error) {
      this.logger.error(`getLlmCredentials failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    const row = data as {
      provider: LlmProviderName;
      model_default: string;
      api_key_last4: string;
      openai_api_key_last4: string | null;
      updated_at: string;
    } | null;

    const mode = (orgData as { ai_keys_mode?: string | null } | null)?.ai_keys_mode;

    return {
      configured: !!row,
      provider: row?.provider ?? 'anthropic',
      model: row?.model_default ?? LLM_DEFAULT_MODEL.anthropic,
      api_key_last4: row?.api_key_last4 ?? null,
      openai_configured: !!row?.openai_api_key_last4,
      openai_api_key_last4: row?.openai_api_key_last4 ?? null,
      ai_keys_mode: mode === 'own' ? 'own' : 'platform',
      available_providers: ['anthropic', 'openai', 'google'],
      available_models: LLM_CATALOG,
      updated_at: row?.updated_at ?? null,
    };
  }

  async updateLlmCredentials(
    orgId: string,
    actorRole: OrgMemberRole,
    dto: UpdateLlmCredentialsDto,
  ): Promise<LlmCredentials> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException(
        'Apenas owner/admin podem alterar a credencial de IA.',
      );
    }

    const { data: existingRow } = await this.supabase.adminClient
      .from('org_llm_credentials')
      .select('provider, model_default, api_key_ciphertext, api_key_last4')
      .eq('org_id', orgId)
      .maybeSingle();

    const existing = existingRow as {
      provider: LlmProviderName;
      model_default: string;
      api_key_ciphertext: string;
      api_key_last4: string;
    } | null;

    // Vamos ter linha de cred de chat após este update? (existente ou nova).
    const willHaveChatRow = !!existing || !!dto.api_key;

    // Guard de lockout: ativar modo 'own' sem nenhuma chave de chat trava
    // toda a IA da org. Exige configurar a chave antes.
    if (dto.ai_keys_mode === 'own' && !willHaveChatRow) {
      throw new BadRequestException(
        'Configure uma chave de IA antes de ativar o modo "usar minhas próprias chaves".',
      );
    }

    // Chave OpenAI dedicada mora na MESMA linha da cred de chat — precisa
    // existir uma linha pra anexá-la.
    if (dto.openai_api_key && !willHaveChatRow) {
      throw new BadRequestException(
        'Configure o provider de chat (com a chave) antes de adicionar uma chave OpenAI dedicada.',
      );
    }

    // Upsert da cred de chat só quando há linha (existente) ou estamos criando.
    if (willHaveChatRow) {
      const nextProvider: LlmProviderName = dto.provider ?? existing?.provider ?? 'anthropic';
      const nextModel = dto.model ?? existing?.model_default ?? LLM_DEFAULT_MODEL[nextProvider];

      if (!LLM_CATALOG[nextProvider].includes(nextModel)) {
        throw new BadRequestException(
          `Modelo "${nextModel}" não é suportado para o provider ${nextProvider}.`,
        );
      }

      // API key: nova ou mantém a atual. Se provider mudou e não há key nova, exigir.
      let api_key_ciphertext: string;
      let api_key_last4: string;
      if (dto.api_key) {
        api_key_ciphertext = encryptApiKey(dto.api_key);
        api_key_last4 = lastFour(dto.api_key);
      } else if (existing && existing.provider === nextProvider) {
        api_key_ciphertext = existing.api_key_ciphertext;
        api_key_last4 = existing.api_key_last4;
      } else {
        throw new BadRequestException(
          'Ao trocar de provider você precisa enviar a nova api_key.',
        );
      }

      // Slot OpenAI dedicado — só incluído no payload quando enviado (omitir
      // preserva o valor atual no upsert; PostgREST só faz SET das keys do JSON).
      const payload: Record<string, unknown> = {
        org_id: orgId,
        provider: nextProvider,
        model_default: nextModel,
        api_key_ciphertext,
        api_key_last4,
      };
      if (dto.openai_api_key) {
        payload.openai_api_key_ciphertext = encryptApiKey(dto.openai_api_key);
        payload.openai_api_key_last4 = lastFour(dto.openai_api_key);
      }

      const { error } = await this.supabase.adminClient
        .from('org_llm_credentials')
        .upsert(payload, { onConflict: 'org_id' });

      if (error) {
        this.logger.error(`updateLlmCredentials upsert failed: ${error.message}`);
        throw new InternalServerErrorException(error.message);
      }
    }

    // Modo BYOK da org (active.organizations.ai_keys_mode).
    if (dto.ai_keys_mode) {
      const { error: modeErr } = await this.supabase.adminClient
        .from('organizations')
        .update({ ai_keys_mode: dto.ai_keys_mode })
        .eq('id', orgId);
      if (modeErr) {
        this.logger.error(`updateLlmCredentials ai_keys_mode failed: ${modeErr.message}`);
        throw new InternalServerErrorException(modeErr.message);
      }
    }

    // Invalida cache do LlmService pra essa org pegar a nova cred + modo no
    // próximo call.
    this.llm.invalidateCache(orgId);

    return this.getLlmCredentials(orgId);
  }

  // ────────────────────────────────────────────
  // AI BUDGET (org_ai_budgets) + USAGE
  // ────────────────────────────────────────────

  async getAiBudget(orgId: string): Promise<AiBudget> {
    const { data, error } = await this.supabase.adminClient
      .from('org_ai_budgets')
      .select('monthly_budget_usd, alert_threshold_pct, hard_cap, updated_at')
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) {
      this.logger.error(`getAiBudget falhou: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    const row = data as {
      monthly_budget_usd: string | number | null;
      alert_threshold_pct: number;
      hard_cap: boolean;
      updated_at: string;
    } | null;

    return {
      configured: !!row,
      monthly_budget_usd:
        row?.monthly_budget_usd !== null && row?.monthly_budget_usd !== undefined
          ? Number(row.monthly_budget_usd)
          : null,
      alert_threshold_pct: row?.alert_threshold_pct ?? 80,
      hard_cap: row?.hard_cap ?? false,
      updated_at: row?.updated_at ?? null,
    };
  }

  async upsertAiBudget(
    orgId: string,
    actorRole: OrgMemberRole,
    dto: UpdateAiBudgetDto,
  ): Promise<AiBudget> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException(
        'Apenas owner/admin podem configurar orçamento de IA.',
      );
    }

    const current = await this.getAiBudget(orgId);
    const next = {
      org_id: orgId,
      monthly_budget_usd:
        dto.monthly_budget_usd === undefined
          ? current.monthly_budget_usd
          : dto.monthly_budget_usd,
      alert_threshold_pct: dto.alert_threshold_pct ?? current.alert_threshold_pct,
      hard_cap: dto.hard_cap ?? current.hard_cap,
    };

    const { error } = await this.supabase.adminClient
      .from('org_ai_budgets')
      .upsert(next, { onConflict: 'org_id' });

    if (error) {
      this.logger.error(`upsertAiBudget falhou: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    // Invalida cache do enforce no LlmService — próximo chat() lê o novo valor
    this.llm.invalidateBudgetCache(orgId);

    return this.getAiBudget(orgId);
  }

  /**
   * Agrega ai_interactions do mês corrente em UTC. Volume mensal típico
   * cabe em memória (≤10k rows = trivial); se crescer >100k vale RPC SQL
   * dedicado com SUM agregado.
   */
  async getAiUsageSummary(orgId: string): Promise<AiUsageSummary> {
    const periodStart = startOfMonthUtc(new Date()).toISOString();
    const rows = await this.fetchInteractions(orgId, periodStart);

    let total_usd = 0;
    let total_input_tokens = 0;
    let total_output_tokens = 0;
    const byFeature = new Map<string, AiUsageBreakdownRow>();
    const byModel = new Map<string, AiUsageBreakdownRow>();

    for (const r of rows) {
      total_usd += r.cost_usd;
      total_input_tokens += r.input_tokens;
      total_output_tokens += r.output_tokens;
      accumulate(byFeature, r.interaction_type || '(unknown)', r);
      accumulate(byModel, r.model || '(unknown)', r);
    }

    const budget = await this.getAiBudget(orgId);
    const pct_used =
      budget.monthly_budget_usd && budget.monthly_budget_usd > 0
        ? roundPct((total_usd / budget.monthly_budget_usd) * 100)
        : 0;

    return {
      period_start: periodStart,
      total_calls: rows.length,
      total_input_tokens,
      total_output_tokens,
      total_usd: roundUsd(total_usd),
      by_feature: sortDesc(byFeature),
      by_model: sortDesc(byModel),
      budget,
      pct_used,
    };
  }

  async getAiUsageTimeline(orgId: string, days = 30): Promise<AiUsageTimeline> {
    const safeDays = Math.min(Math.max(days, 1), 90);
    const start = new Date(Date.now() - safeDays * 86_400_000);
    start.setUTCHours(0, 0, 0, 0);

    const rows = await this.fetchInteractions(orgId, start.toISOString());

    const byDay = new Map<string, AiUsageTimelinePoint>();
    for (let i = 0; i < safeDays; i++) {
      const d = new Date(start.getTime() + i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, { date: key, calls: 0, usd: 0 });
    }
    for (const r of rows) {
      const key = r.created_at.slice(0, 10);
      const point = byDay.get(key);
      if (!point) continue;
      point.calls += 1;
      point.usd += r.cost_usd;
    }
    for (const p of byDay.values()) p.usd = roundUsd(p.usd);

    return {
      days: safeDays,
      series: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  private async fetchInteractions(
    orgId: string,
    sinceIso: string,
  ): Promise<
    Array<{
      interaction_type: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
      created_at: string;
    }>
  > {
    const { data, error } = await this.supabase.adminClient
      .from('ai_interactions')
      .select('interaction_type, model, input_tokens, output_tokens, cost_usd, created_at')
      .eq('org_id', orgId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(20000);
    if (error) {
      this.logger.error(`fetchInteractions falhou: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return (data ?? []) as Array<{
      interaction_type: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
      created_at: string;
    }>;
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers locais
// ─────────────────────────────────────────────────────────────

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
}

function accumulate(
  map: Map<string, AiUsageBreakdownRow>,
  key: string,
  r: {
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
  },
): void {
  const existing = map.get(key);
  if (existing) {
    existing.calls += 1;
    existing.usd += r.cost_usd;
    existing.input_tokens += r.input_tokens;
    existing.output_tokens += r.output_tokens;
  } else {
    map.set(key, {
      key,
      calls: 1,
      usd: r.cost_usd,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
    });
  }
}

function sortDesc(map: Map<string, AiUsageBreakdownRow>): AiUsageBreakdownRow[] {
  return Array.from(map.values())
    .map((r) => ({ ...r, usd: roundUsd(r.usd) }))
    .sort((a, b) => b.usd - a.usd);
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function roundPct(n: number): number {
  return Math.round(n * 100) / 100;
}
