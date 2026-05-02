import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { EventsGateway } from '../../gateways/events.gateway';

/**
 * Cria deal automaticamente quando um contato novo envia primeira mensagem,
 * baseado em `organizations.settings.auto_create_deal`. Setting esperada:
 *
 *   {
 *     enabled: boolean,
 *     pipeline_id: uuid | null,
 *     stage_id: uuid | null,
 *     ai_position: boolean   // se true, a IA pode escolher o stage
 *   }
 *
 * Best-effort: erros aqui nunca derrubam o webhook (chamado fire-and-forget).
 */
@Injectable()
export class AutoLeadService {
  private readonly logger = new Logger(AutoLeadService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly events: EventsGateway,
  ) {}

  /**
   * Chamado após findOrCreateConversation no webhook. Só cria deal se:
   *   1. setting `auto_create_deal.enabled` é true
   *   2. o contato AINDA NÃO tem nenhum deal ativo (open) — assim primeiras
   *      mensagens em conversas reabertas não duplicam
   *   3. existe um pipeline alvo (configurado ou default da org)
   */
  async handleNewContact(args: {
    orgId: string;
    contactId: string;
    conversationId: string;
    /** Hints da IA pra escolher o stage (opcional). */
    aiIntent?: string | null;
    aiTemperature?: 'cold' | 'warm' | 'hot' | 'very_hot' | null;
  }): Promise<void> {
    try {
      const settings = await this.loadOrgSettings(args.orgId);
      const cfg = settings?.auto_create_deal;
      if (!cfg || !cfg.enabled) return;

      // Já existe deal ativo pra esse contato? Skip.
      const { data: existing } = await this.supabase.adminClient
        .from('deals')
        .select('id')
        .eq('org_id', args.orgId)
        .eq('contact_id', args.contactId)
        .is('won_at', null)
        .is('lost_at', null)
        .limit(1)
        .maybeSingle();
      if (existing) return;

      // Resolve pipeline
      const pipelineId =
        cfg.pipeline_id ?? (await this.findDefaultPipelineId(args.orgId));
      if (!pipelineId) {
        this.logger.debug(`auto-lead: org ${args.orgId} sem pipeline alvo`);
        return;
      }

      // Resolve stage
      const stageId = await this.resolveTargetStage({
        pipelineId,
        configuredStageId: cfg.stage_id ?? null,
        aiPositioning: cfg.ai_position !== false,
        aiIntent: args.aiIntent ?? null,
        aiTemperature: args.aiTemperature ?? null,
      });
      if (!stageId) {
        this.logger.debug(`auto-lead: pipeline ${pipelineId} sem stage utilizável`);
        return;
      }

      // Carrega nome do contato pra title do deal
      const contactName = await this.fetchContactName(args.orgId, args.contactId);
      const title = contactName ? `Lead — ${contactName}` : 'Lead — sem nome';

      // Cria o deal — trigger SQL `set_deal_number` cuida do número sequencial
      const { data: deal, error: dealErr } = await this.supabase.adminClient
        .from('deals')
        .insert({
          org_id: args.orgId,
          pipeline_id: pipelineId,
          stage_id: stageId,
          contact_id: args.contactId,
          conversation_id: args.conversationId,
          title,
          value: 0,
          currency: 'BRL',
          tags: ['lead-automatico'],
          custom_fields: {
            auto_created: true,
            auto_created_at: new Date().toISOString(),
          },
        })
        .select('*')
        .single();

      if (dealErr || !deal) {
        this.logger.warn(`auto-lead: falha ao criar deal — ${dealErr?.message}`);
        return;
      }

      this.events.emitToOrg(args.orgId, 'deal:created', { deal });
      this.logger.log(`auto-lead: criado deal ${deal.id} pra contato ${args.contactId}`);
    } catch (err) {
      this.logger.warn(
        `auto-lead failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────

  private async loadOrgSettings(orgId: string): Promise<OrgSettings | null> {
    const { data, error } = await this.supabase.adminClient
      .from('organizations')
      .select('settings')
      .eq('id', orgId)
      .maybeSingle();
    if (error || !data) return null;
    return ((data as { settings: OrgSettings | null }).settings ?? null) as OrgSettings | null;
  }

  private async findDefaultPipelineId(orgId: string): Promise<string | null> {
    // Tenta default primeiro
    const { data: def } = await this.supabase.adminClient
      .from('pipelines')
      .select('id')
      .eq('org_id', orgId)
      .eq('is_default', true)
      .is('archived_at', null)
      .limit(1)
      .maybeSingle();
    if (def) return (def as { id: string }).id;

    // Fallback: primeiro pipeline ativo
    const { data: any } = await this.supabase.adminClient
      .from('pipelines')
      .select('id')
      .eq('org_id', orgId)
      .is('archived_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (any as { id: string } | null)?.id ?? null;
  }

  /**
   * Heurística pra escolher o stage:
   *   - Se `configuredStageId` setado, usa ele direto
   *   - Senão, se aiPositioning + intent/temperatura, tenta posicionar mais
   *     adiante: hot/very_hot + budget intent → stage 2 (qualificação típica),
   *     warm → stage 1, cold/null → stage 0 (primeiro)
   *   - Fallback: primeiro stage não-won/lost
   */
  private async resolveTargetStage(args: {
    pipelineId: string;
    configuredStageId: string | null;
    aiPositioning: boolean;
    aiIntent: string | null;
    aiTemperature: string | null;
  }): Promise<string | null> {
    if (args.configuredStageId) {
      // Valida que o stage pertence ao pipeline e não é won/lost
      const { data } = await this.supabase.adminClient
        .from('pipeline_stages')
        .select('id, is_won, is_lost')
        .eq('id', args.configuredStageId)
        .eq('pipeline_id', args.pipelineId)
        .maybeSingle();
      if (data && !(data as { is_won: boolean; is_lost: boolean }).is_won) {
        return (data as { id: string }).id;
      }
    }

    // Lê todos os stages ordenados
    const { data: stages, error } = await this.supabase.adminClient
      .from('pipeline_stages')
      .select('id, position, is_won, is_lost')
      .eq('pipeline_id', args.pipelineId)
      .order('position', { ascending: true });

    if (error) return null;
    const eligible = ((stages ?? []) as Array<{ id: string; is_won: boolean; is_lost: boolean }>)
      .filter((s) => !s.is_won && !s.is_lost);
    if (eligible.length === 0) return null;

    if (args.aiPositioning) {
      const idx = this.aiSuggestedIndex(eligible.length, args.aiIntent, args.aiTemperature);
      return eligible[idx]?.id ?? eligible[0]!.id;
    }

    return eligible[0]!.id;
  }

  /**
   * Mapeamento simples temperatura/intent → índice no array de stages
   * elegíveis. Não substitui modelo IA dedicado — heurística leve sem
   * custo adicional.
   */
  private aiSuggestedIndex(
    available: number,
    intent: string | null,
    temperature: string | null,
  ): number {
    const last = available - 1;
    if (temperature === 'very_hot' && intent === 'budget') {
      return Math.min(2, last);
    }
    if (temperature === 'hot') {
      return Math.min(1, last);
    }
    if (temperature === 'warm') {
      return Math.min(1, last);
    }
    return 0;
  }

  private async fetchContactName(orgId: string, contactId: string): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('contacts')
      .select('name, phone')
      .eq('org_id', orgId)
      .eq('id', contactId)
      .maybeSingle();
    if (!data) return null;
    const row = data as { name: string | null; phone: string | null };
    return row.name ?? row.phone ?? null;
  }
}

// ──────────────────────────────────────────────────────────
// Shape esperado em organizations.settings (jsonb)
// ──────────────────────────────────────────────────────────

interface OrgSettings {
  auto_create_deal?: AutoCreateDealSetting;
}

export interface AutoCreateDealSetting {
  enabled: boolean;
  pipeline_id?: string | null;
  stage_id?: string | null;
  /** Permite IA escolher o stage. Default: true. */
  ai_position?: boolean;
}
