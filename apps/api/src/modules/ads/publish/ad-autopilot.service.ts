import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { MetaPublishService } from './meta-publish.service';

export type AutopilotAction =
  | 'pause'
  | 'resume'
  | 'decrease_budget'
  | 'increase_budget'
  | 'refresh_creative';

interface PlaybookEntry {
  action: AutopilotAction;
  pct?: number;
  label: string;
  rationale: string;
}

/** Sinal (signal_type do detector) → ação recomendada. */
const PLAYBOOK: Record<string, PlaybookEntry> = {
  roas_collapse: { action: 'pause', label: 'Pausar campanha', rationale: 'ROAS despencou — pausar pra estancar a perda.' },
  pixel_drift: { action: 'pause', label: 'Pausar campanha', rationale: 'Conversões caíram com gasto estável — possível falha de rastreamento.' },
  cpa_inflation: { action: 'decrease_budget', pct: -0.3, label: 'Reduzir orçamento 30%', rationale: 'CPA inflado — reduzir até o custo normalizar.' },
  scaling_inefficiency: { action: 'decrease_budget', pct: -0.25, label: 'Reduzir orçamento 25%', rationale: 'Gasto subiu sem conversão proporcional.' },
  budget_pacing: { action: 'decrease_budget', pct: -0.2, label: 'Reduzir orçamento 20%', rationale: 'Gastando rápido demais — suavizar o ritmo.' },
  creative_fatigue: { action: 'refresh_creative', label: 'Renovar criativo', rationale: 'CTR caiu e frequência subiu — o criativo cansou. Gere um novo na aba Anúncios.' },
  audience_burnout: { action: 'refresh_creative', label: 'Renovar criativo / público', rationale: 'Frequência alta e CTR caindo — público saturado.' },
};

export interface AutopilotSuggestion {
  signal_id: string;
  integration_id: string;
  campaign_external_id: string;
  campaign_name: string;
  signal_type: string;
  severity: string;
  current_value: number | null;
  action: AutopilotAction;
  pct?: number;
  label: string;
  rationale: string;
}

/**
 * AdAutopilotService — transforma os sinais do detector (Bloco G) em AÇÕES
 * acionáveis com 1 clique (com aprovação): pausar, ajustar orçamento,
 * renovar criativo. NUNCA executa sozinho — o usuário aprova cada ação.
 */
@Injectable()
export class AdAutopilotService {
  private readonly logger = new Logger(AdAutopilotService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly publisher: MetaPublishService,
  ) {}

  /** Sugestões abertas (sinais pendentes mapeados pra ações). */
  async suggestions(orgId: string): Promise<AutopilotSuggestion[]> {
    const { data: signals, error } = await this.supabase.adminClient
      .from('ad_signals')
      .select('id, integration_id, campaign_id, signal_type, severity, current_value')
      .eq('org_id', orgId)
      .in('status', ['pending', 'sent'])
      .order('generated_at', { ascending: false })
      .limit(60);
    if (error) throw new InternalServerErrorException(error.message);

    const list = (signals ?? []) as Array<{
      id: string; integration_id: string; campaign_id: string;
      signal_type: string; severity: string; current_value: number | null;
    }>;
    const actionable = list.filter((s) => PLAYBOOK[s.signal_type]);
    if (!actionable.length) return [];

    const campIds = Array.from(new Set(actionable.map((s) => s.campaign_id).filter(Boolean)));
    const { data: camps } = await this.supabase.adminClient
      .from('ad_campaigns')
      .select('id, external_id, name')
      .in('id', campIds);
    const byId = new Map(
      ((camps ?? []) as Array<{ id: string; external_id: string; name: string }>).map((c) => [c.id, c]),
    );

    const out: AutopilotSuggestion[] = [];
    for (const s of actionable) {
      const camp = byId.get(s.campaign_id);
      if (!camp) continue;
      const pb = PLAYBOOK[s.signal_type]!;
      out.push({
        signal_id: s.id,
        integration_id: s.integration_id,
        campaign_external_id: camp.external_id,
        campaign_name: camp.name,
        signal_type: s.signal_type,
        severity: s.severity,
        current_value: s.current_value,
        action: pb.action,
        pct: pb.pct,
        label: pb.label,
        rationale: pb.rationale,
      });
    }
    return out;
  }

  /** Aplica uma ação sugerida (com aprovação do usuário). */
  async apply(
    orgId: string,
    userId: string,
    dto: { signal_id: string; action: AutopilotAction; pct?: number },
  ): Promise<{ ok: true; result: unknown }> {
    const sig = await this.loadSignal(orgId, dto.signal_id);
    const camp = await this.resolveCampaign(sig.campaign_id);
    if (!camp) throw new NotFoundException('Campanha do sinal não encontrada.');

    let result: unknown = { note: 'sem ação no Meta' };
    try {
      if (dto.action === 'pause') {
        await this.publisher.setCampaignStatus(orgId, sig.integration_id, camp.external_id, 'PAUSED');
        result = { status: 'PAUSED' };
      } else if (dto.action === 'resume') {
        await this.publisher.setCampaignStatus(orgId, sig.integration_id, camp.external_id, 'ACTIVE');
        result = { status: 'ACTIVE' };
      } else if (dto.action === 'decrease_budget' || dto.action === 'increase_budget') {
        const pct = dto.pct ?? PLAYBOOK[sig.signal_type]?.pct ?? (dto.action === 'increase_budget' ? 0.3 : -0.3);
        result = await this.publisher.adjustCampaignBudgetByPct(orgId, sig.integration_id, camp.external_id, pct);
      } else if (dto.action === 'refresh_creative') {
        result = { note: 'Renovar criativo é manual — gere um novo anúncio na aba.' };
      }

      await this.logAction(orgId, userId, sig, camp, dto.action, 'applied', result, null);
      await this.ackSignal(orgId, dto.signal_id, userId);
      this.logger.log(`[autopilot] org=${orgId} ${dto.action} em ${camp.name} (sinal ${sig.signal_type})`);
      return { ok: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.logAction(orgId, userId, sig, camp, dto.action, 'failed', null, msg);
      throw err instanceof BadRequestException ? err : new BadRequestException(msg);
    }
  }

  /** Dispensa uma sugestão (ack o sinal sem agir). */
  async dismiss(orgId: string, userId: string, signalId: string): Promise<void> {
    const sig = await this.loadSignal(orgId, signalId);
    const camp = await this.resolveCampaign(sig.campaign_id);
    await this.logAction(
      orgId, userId, sig,
      camp ?? { external_id: '', name: '' },
      'refresh_creative', 'dismissed', null, null,
    );
    await this.ackSignal(orgId, signalId, userId);
  }

  /** Histórico de ações aplicadas/dispensadas. */
  async history(orgId: string): Promise<unknown[]> {
    const { data, error } = await this.supabase.adminClient
      .from('ad_actions')
      .select('id, campaign_name, action_type, rationale, status, result, last_error, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new InternalServerErrorException(error.message);
    return data ?? [];
  }

  // ── internals ──────────────────────────────────────────────

  private async loadSignal(orgId: string, signalId: string) {
    const { data, error } = await this.supabase.adminClient
      .from('ad_signals')
      .select('id, integration_id, campaign_id, signal_type, severity')
      .eq('org_id', orgId)
      .eq('id', signalId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Sinal não encontrado.');
    return data as { id: string; integration_id: string; campaign_id: string; signal_type: string; severity: string };
  }

  private async resolveCampaign(campaignUuid: string): Promise<{ external_id: string; name: string } | null> {
    const { data } = await this.supabase.adminClient
      .from('ad_campaigns')
      .select('external_id, name')
      .eq('id', campaignUuid)
      .maybeSingle();
    return (data as { external_id: string; name: string } | null) ?? null;
  }

  private async ackSignal(orgId: string, signalId: string, userId: string): Promise<void> {
    await this.supabase.adminClient
      .from('ad_signals')
      .update({ status: 'acked', ack_at: new Date().toISOString(), acked_by: userId })
      .eq('org_id', orgId)
      .eq('id', signalId);
  }

  private async logAction(
    orgId: string,
    userId: string,
    sig: { id: string; integration_id: string; signal_type: string },
    camp: { external_id: string; name: string },
    action: AutopilotAction,
    status: 'applied' | 'dismissed' | 'failed',
    result: unknown,
    lastError: string | null,
  ): Promise<void> {
    await this.supabase.adminClient.from('ad_actions').insert({
      org_id: orgId,
      integration_id: sig.integration_id,
      signal_id: sig.id,
      campaign_external_id: camp.external_id,
      campaign_name: camp.name,
      action_type: action,
      rationale: PLAYBOOK[sig.signal_type]?.rationale ?? null,
      params: PLAYBOOK[sig.signal_type]?.pct != null ? { pct: PLAYBOOK[sig.signal_type]!.pct } : {},
      status,
      result: result ?? null,
      last_error: lastError,
      created_by: userId,
    });
  }
}
