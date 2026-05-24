import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { SupabaseService } from '../supabase/supabase.service';
import {
  LlmChatInput,
  LlmChatResult,
  LlmProvider,
  LlmProviderName,
  LLM_DEFAULT_MODEL,
} from './llm-provider.interface';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAIProvider } from './providers/openai.provider';
import { GoogleProvider } from './providers/google.provider';
import { decryptApiKey } from './crypto.util';
import { AiKeyRequiredException } from './ai-key-required.exception';

/** Modo de chaves de IA da org (active.organizations.ai_keys_mode). */
type AiKeysMode = 'platform' | 'own';

interface ChatRequest {
  /** Org dona da chamada — resolve credencial + escopa o tracking. */
  orgId: string;
  /**
   * Identificador da feature consumindo (ex: 're_engagement',
   * 'concierge_greeting', 'attachment_vision'). Vai pro
   * `ai_interactions.interaction_type`.
   */
  feature: string;
  system: string;
  /** Mensagens do turno (se string única, vira role=user simples). */
  user: string | LlmChatInput['messages'];
  max_tokens?: number;
  json_mode?: boolean;
  tools?: LlmChatInput['tools'];
  temperature?: number;
  /** FKs opcionais pra ai_interactions. */
  context?: {
    conversation_id?: string;
    contact_id?: string;
    deal_id?: string;
    user_id?: string;
  };
  /** Metadata livre pra logar junto. */
  metadata?: Record<string, unknown>;
  /**
   * Quando true, pula o insert em ai_interactions. Use só quando o caller
   * loga manualmente (ex: concierge decide pós-fato qual interaction_type
   * usar — `qualify` vs `route` — baseado no resultado da IA).
   */
  disable_logging?: boolean;
}

interface ChatResponse extends LlmChatResult {
  /** ID da row em ai_interactions; null se logging falhou. */
  interaction_id: string | null;
}

interface OrgCredRow {
  provider: LlmProviderName;
  model_default: string;
  api_key_ciphertext: string;
  openai_api_key_ciphertext?: string | null;
}

interface CachedProvider {
  provider: LlmProvider;
  /** Hash do ciphertext: cache invalida se cred trocar. */
  ciphertextKey: string;
}

/**
 * Service unificado de chamadas LLM.
 *
 * Responsabilidades:
 *   1. Resolver credencial da org (DB) — fallback pra ANTHROPIC_API_KEY env
 *      durante onboarding (org sem cred configurada usa Anthropic com Sonnet).
 *   2. Instanciar provider correto, cachear por org (chave inclui ciphertext
 *      pra auto-invalidar no rotate).
 *   3. Despachar chat() pro provider.
 *   4. Logar custo+tokens+latência em active.ai_interactions (best-effort).
 *
 * Princípios:
 *   - Multi-tenant: orgId obrigatório em todo call.
 *   - PT-BR: erros ao user em PT-BR (UI catch & display).
 *   - IA aplicada: este serviço É a fundação que outros módulos usam
 *     pra adicionar IA sem reimplementar tracking/cred resolution.
 */
@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private readonly cache = new Map<string, CachedProvider>();

  constructor(private readonly supabase: SupabaseService) {}

  onModuleInit(): void {
    if (!process.env.LLM_CRED_ENCRYPTION_KEY) {
      this.logger.warn(
        'LLM_CRED_ENCRYPTION_KEY ausente — orgs sem cred caem no fallback ANTHROPIC_API_KEY; orgs com cred vão falhar ao decifrar.',
      );
    }
  }

  // ──────────────────────────────────────────────────────────
  // Cred management
  // ──────────────────────────────────────────────────────────

  /**
   * Resolve provider pra uma org. Lê de org_llm_credentials; se ausente,
   * cai no fallback global (Anthropic + ANTHROPIC_API_KEY env).
   */
  async resolveProvider(orgId: string): Promise<{
    provider: LlmProvider;
    providerName: LlmProviderName;
    model: string;
  }> {
    const { data, error } = await this.supabase.adminClient
      .from('org_llm_credentials')
      .select('provider, model_default, api_key_ciphertext')
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) {
      this.logger.warn(`org_llm_credentials lookup falhou: ${error.message} — caindo no fallback`);
    }

    const row = data as OrgCredRow | null;

    if (row) {
      const cached = this.cache.get(orgId);
      if (cached && cached.ciphertextKey === row.api_key_ciphertext) {
        return {
          provider: cached.provider,
          providerName: row.provider,
          model: row.model_default,
        };
      }
      const apiKey = decryptApiKey(row.api_key_ciphertext);
      const provider = instantiateProvider(row.provider, apiKey);
      this.cache.set(orgId, { provider, ciphertextKey: row.api_key_ciphertext });
      return { provider, providerName: row.provider, model: row.model_default };
    }

    // BYOK: org sem cred própria. Em modo 'own', bloqueia (exige chave da org)
    // em vez de cair na chave do servidor. Em 'platform', usa o fallback env.
    const mode = await this.getOrgAiKeysMode(orgId);
    if (mode === 'own') {
      throw new AiKeyRequiredException('IA');
    }

    // Fallback: ANTHROPIC_API_KEY env, claude-sonnet-4-6.
    const fallbackKey = process.env.ANTHROPIC_API_KEY;
    if (!fallbackKey) {
      throw new Error(
        'Nenhuma credencial de IA configurada pra esta org e ANTHROPIC_API_KEY está ausente. Configure em /configuracoes > IA.',
      );
    }
    const cacheKey = `__fallback__${orgId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return {
        provider: cached.provider,
        providerName: 'anthropic',
        model: LLM_DEFAULT_MODEL.anthropic,
      };
    }
    const provider = new AnthropicProvider(fallbackKey);
    this.cache.set(cacheKey, { provider, ciphertextKey: '__env__' });
    return {
      provider,
      providerName: 'anthropic',
      model: LLM_DEFAULT_MODEL.anthropic,
    };
  }

  /** Invalida cache pra uma org — chamado por settings.controller após PATCH. */
  invalidateCache(orgId: string): void {
    this.cache.delete(orgId);
    this.cache.delete(`__fallback__${orgId}`);
    this.modeCache.delete(orgId);
  }

  // ──────────────────────────────────────────────────────────
  // BYOK — ai_keys_mode + resolução de chave OpenAI por org
  // ──────────────────────────────────────────────────────────

  private modeCache = new Map<string, { mode: AiKeysMode; expiresAt: number }>();
  private static readonly MODE_CACHE_TTL_MS = 60_000;

  /**
   * Lê active.organizations.ai_keys_mode. 'platform' (usa chave do servidor)
   * ou 'own' (exige chave própria → bloqueia IA sem chave). Default 'platform'
   * se a coluna estiver ausente/null (ex: pré-migração) pra não quebrar nada.
   * Cacheado 60s.
   */
  async getOrgAiKeysMode(orgId: string): Promise<AiKeysMode> {
    const cached = this.modeCache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) return cached.mode;

    const { data } = await this.supabase.adminClient
      .from('organizations')
      .select('ai_keys_mode')
      .eq('id', orgId)
      .maybeSingle();

    const raw = (data as { ai_keys_mode?: string | null } | null)?.ai_keys_mode;
    const mode: AiKeysMode = raw === 'own' ? 'own' : 'platform';
    this.modeCache.set(orgId, { mode, expiresAt: Date.now() + LlmService.MODE_CACHE_TTL_MS });
    return mode;
  }

  /**
   * Resolve a chave OpenAI pros serviços auxiliares (Whisper, embeddings,
   * DALL·E) — que são OpenAI-only, independentes do provider de chat.
   *
   * Ordem:
   *   1. Se o provider de chat da org JÁ é openai → reusa api_key_ciphertext.
   *   2. Senão, slot dedicado openai_api_key_ciphertext (se configurado).
   *   3. Senão: modo 'platform' → env OPENAI_API_KEY.
   *   4. Senão (modo 'own' sem chave): se `allowNull` → retorna null (worker
   *      pula graciosamente); senão lança AiKeyRequiredException.
   */
  async resolveOpenAiKey(
    orgId: string,
    opts: { allowNull?: boolean } = {},
  ): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('org_llm_credentials')
      .select('provider, api_key_ciphertext, openai_api_key_ciphertext')
      .eq('org_id', orgId)
      .maybeSingle();

    const row = data as {
      provider: LlmProviderName;
      api_key_ciphertext: string;
      openai_api_key_ciphertext: string | null;
    } | null;

    if (row?.provider === 'openai' && row.api_key_ciphertext) {
      return decryptApiKey(row.api_key_ciphertext);
    }
    if (row?.openai_api_key_ciphertext) {
      return decryptApiKey(row.openai_api_key_ciphertext);
    }

    const mode = await this.getOrgAiKeysMode(orgId);
    if (mode === 'platform') {
      return process.env.OPENAI_API_KEY ?? null;
    }
    // modo 'own' sem chave OpenAI
    if (opts.allowNull) return null;
    throw new AiKeyRequiredException('OpenAI');
  }

  /**
   * Escape hatch pra features que ainda dependem do SDK Anthropic direto
   * (ex: copilot tool-use loop). Resolve a cred da org; se a org configurou
   * provider != anthropic, devolve o fallback ANTHROPIC_API_KEY env (com
   * warning). Quando a interface LlmProvider cobrir tool-use multi-turn,
   * este método pode ser removido.
   */
  async getAnthropicClientForOrg(orgId: string): Promise<{ client: Anthropic; model: string }> {
    const { data } = await this.supabase.adminClient
      .from('org_llm_credentials')
      .select('provider, model_default, api_key_ciphertext')
      .eq('org_id', orgId)
      .maybeSingle();

    const row = data as
      | {
          provider: LlmProviderName;
          model_default: string;
          api_key_ciphertext: string;
        }
      | null;

    if (row && row.provider === 'anthropic') {
      const apiKey = decryptApiKey(row.api_key_ciphertext);
      return { client: new Anthropic({ apiKey, maxRetries: 2 }), model: row.model_default };
    }

    if (row && row.provider !== 'anthropic') {
      this.logger.warn(
        `[copilot/anthropic-direct] org=${orgId} configurada com ${row.provider} mas feature exige Anthropic — caindo no fallback env`,
      );
    }

    // BYOK: sem cred Anthropic da org e modo 'own' → bloqueia em vez de usar
    // a chave do servidor.
    if (!row) {
      const mode = await this.getOrgAiKeysMode(orgId);
      if (mode === 'own') {
        throw new AiKeyRequiredException('Anthropic');
      }
    }

    const fallbackKey = process.env.ANTHROPIC_API_KEY;
    if (!fallbackKey) {
      throw new Error(
        'Esta funcionalidade exige Anthropic. Configure provider=anthropic em /configuracoes > IA, ou defina ANTHROPIC_API_KEY no servidor.',
      );
    }
    return {
      client: new Anthropic({ apiKey: fallbackKey, maxRetries: 2 }),
      model: LLM_DEFAULT_MODEL.anthropic,
    };
  }

  // ──────────────────────────────────────────────────────────
  // Chat
  // ──────────────────────────────────────────────────────────

  async chat(req: ChatRequest): Promise<ChatResponse> {
    await this.enforceMonthlyBudget(req.orgId, req.feature);

    const { provider, providerName, model } = await this.resolveProvider(req.orgId);

    const messages =
      typeof req.user === 'string'
        ? [{ role: 'user' as const, content: req.user }]
        : req.user;

    const input: LlmChatInput = {
      system: req.system,
      messages,
      max_tokens: req.max_tokens,
      json_mode: req.json_mode,
      tools: req.tools,
      temperature: req.temperature,
    };

    let result: LlmChatResult;
    try {
      result = await provider.chat(model, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[${req.feature}] provider=${providerName} model=${model} falhou: ${message}`);
      // Loga interação falhada (cost=0) pra visibilidade
      void this.logInteraction({
        org_id: req.orgId,
        interaction_type: req.feature,
        provider: providerName,
        model,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        latency_ms: 0,
        result_summary: `ERROR: ${message.slice(0, 180)}`,
        ...req.context,
        metadata: { ...(req.metadata ?? {}), error: message },
      });
      throw err;
    }

    const interaction_id = req.disable_logging
      ? null
      : await this.logInteraction({
          org_id: req.orgId,
          interaction_type: req.feature,
          provider: providerName,
          model,
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          cost_usd: result.cost_usd,
          latency_ms: result.latency_ms,
          result_summary:
            result.text.slice(0, 200) ||
            `(tool_use ${result.tool_calls.map((t) => t.name).join(',')})`,
          ...req.context,
          metadata: req.metadata ?? {},
        });

    return { ...result, interaction_id };
  }

  // ──────────────────────────────────────────────────────────
  // Cap mensal (org_ai_budgets) — bloqueia chat() quando hard_cap=true
  // e spend acumulado >= monthly_budget_usd. Lookup cacheado 60s pra
  // não taxar hot path com SELECT redundante.
  // ──────────────────────────────────────────────────────────

  private budgetCache = new Map<
    string,
    {
      monthly_budget_usd: number | null;
      hard_cap: boolean;
      expiresAt: number;
    }
  >();

  private static readonly BUDGET_CACHE_TTL_MS = 60_000;

  private async enforceMonthlyBudget(orgId: string, feature: string): Promise<void> {
    const cached = this.budgetCache.get(orgId);
    let budget = cached && cached.expiresAt > Date.now() ? cached : null;

    if (!budget) {
      const { data } = await this.supabase.adminClient
        .from('org_ai_budgets')
        .select('monthly_budget_usd, hard_cap')
        .eq('org_id', orgId)
        .maybeSingle();
      const row = data as {
        monthly_budget_usd: string | number | null;
        hard_cap: boolean;
      } | null;
      budget = {
        monthly_budget_usd:
          row?.monthly_budget_usd !== null && row?.monthly_budget_usd !== undefined
            ? Number(row.monthly_budget_usd)
            : null,
        hard_cap: row?.hard_cap ?? false,
        expiresAt: Date.now() + LlmService.BUDGET_CACHE_TTL_MS,
      };
      this.budgetCache.set(orgId, budget);
    }

    // Sem hard_cap ou sem budget definido → skip (só telemetria via ai_interactions)
    if (!budget.hard_cap || budget.monthly_budget_usd === null) return;
    if (budget.monthly_budget_usd <= 0) return;

    const periodStart = startOfMonthUtc(new Date()).toISOString();
    const spent = await this.sumMonthlySpend(orgId, periodStart);

    if (spent >= budget.monthly_budget_usd) {
      this.logger.warn(
        `[${feature}] org=${orgId} bloqueado por hard_cap: spent=${spent.toFixed(4)} >= budget=${budget.monthly_budget_usd}`,
      );
      throw new BadRequestException(
        'Orçamento mensal de IA atingido. Ajuste em /configuracoes > Uso de IA.',
      );
    }
  }

  /** Invalida cache do budget — chamado por settings após PATCH em ai-budget. */
  invalidateBudgetCache(orgId: string): void {
    this.budgetCache.delete(orgId);
  }

  private async sumMonthlySpend(orgId: string, sinceIso: string): Promise<number> {
    const { data, error } = await this.supabase.adminClient
      .from('ai_interactions')
      .select('cost_usd')
      .eq('org_id', orgId)
      .gte('created_at', sinceIso)
      .limit(50000);
    if (error) {
      this.logger.warn(`sumMonthlySpend falhou (assumindo 0): ${error.message}`);
      return 0;
    }
    let total = 0;
    for (const r of (data ?? []) as Array<{ cost_usd: string | number }>) {
      const v = typeof r.cost_usd === 'string' ? Number(r.cost_usd) : r.cost_usd;
      if (Number.isFinite(v)) total += v;
    }
    return total;
  }

  // ──────────────────────────────────────────────────────────
  // Logging (best-effort — never fails the call)
  // ──────────────────────────────────────────────────────────

  private async logInteraction(input: {
    org_id: string;
    interaction_type: string;
    provider: LlmProviderName;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    latency_ms: number;
    conversation_id?: string;
    contact_id?: string;
    deal_id?: string;
    user_id?: string;
    result_summary: string | null;
    metadata: Record<string, unknown>;
  }): Promise<string | null> {
    try {
      const { data, error } = await this.supabase.adminClient
        .from('ai_interactions')
        .insert({
          org_id: input.org_id,
          interaction_type: input.interaction_type,
          model: input.model,
          provider: input.provider,
          input_tokens: input.input_tokens,
          output_tokens: input.output_tokens,
          cost_usd: input.cost_usd,
          latency_ms: input.latency_ms,
          conversation_id: input.conversation_id ?? null,
          contact_id: input.contact_id ?? null,
          deal_id: input.deal_id ?? null,
          user_id: input.user_id ?? null,
          result_summary: input.result_summary,
          metadata: input.metadata,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return (data as { id: string } | null)?.id ?? null;
    } catch (err) {
      this.logger.warn(
        `ai_interactions log falhou (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}

function instantiateProvider(name: LlmProviderName, apiKey: string): LlmProvider {
  switch (name) {
    case 'anthropic':
      return new AnthropicProvider(apiKey);
    case 'openai':
      return new OpenAIProvider(apiKey);
    case 'google':
      return new GoogleProvider(apiKey);
  }
}

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
}
