import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { OrgMemberRole } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  CreateRoutingRuleDto,
  UpdateRoutingRuleDto,
} from './alerts.dto';

export type DeliveryMode =
  | 'immediate'
  | 'digest_8h'
  | 'digest_14h'
  | 'digest_18h'
  | 'weekly';

export type RuleSeverity = 'warning' | 'critical';

export interface AlertRoutingRule {
  id: string;
  org_id: string;
  name: string | null;
  signal_type: string;
  min_severity: RuleSeverity;
  manager_ids: string[];
  delivery_mode: DeliveryMode;
  business_hours_only: boolean;
  enabled: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

/** Sinal mínimo que o resolveRecipients precisa pra fazer matching. */
export interface SignalForRouting {
  signal_type: string;
  severity: RuleSeverity;
}

export interface ResolvedRecipient {
  manager_id: string;
  delivery_mode: DeliveryMode;
  business_hours_only: boolean;
  rule_id: string;
}

const SEVERITY_RANK: Record<RuleSeverity, number> = {
  warning: 1,
  critical: 2,
};

/**
 * AlertRoutingService — CRUD rules + matching engine.
 *
 * Matching:
 *   1. Pega rules enabled da org
 *   2. Filtra: signal_type bate (exato ou '*') E severity >= min_severity
 *   3. Ordena por priority asc (1=top)
 *   4. Pra cada manager listado, devolve 1 ResolvedRecipient com a
 *      rule de menor priority (1ª que pegou aquele manager).
 *
 * Multi-tenant: TODA query filtra org_id.
 */
@Injectable()
export class AlertRoutingService {
  private readonly logger = new Logger(AlertRoutingService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ────────────────────────────────────────────
  // CRUD
  // ────────────────────────────────────────────

  async list(orgId: string): Promise<AlertRoutingRule[]> {
    const { data, error } = await this.supabase.adminClient
      .from('alert_routing_rules')
      .select('*')
      .eq('org_id', orgId)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) {
      this.logger.error(`list rules falhou: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return (data ?? []) as AlertRoutingRule[];
  }

  async create(
    orgId: string,
    actorRole: OrgMemberRole,
    dto: CreateRoutingRuleDto,
  ): Promise<AlertRoutingRule> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException(
        'Apenas owner/admin podem criar regras de roteamento.',
      );
    }
    const { data, error } = await this.supabase.adminClient
      .from('alert_routing_rules')
      .insert({
        org_id: orgId,
        name: dto.name ?? null,
        signal_type: dto.signal_type,
        min_severity: dto.min_severity ?? 'warning',
        manager_ids: dto.manager_ids,
        delivery_mode: dto.delivery_mode,
        business_hours_only: dto.business_hours_only ?? false,
        enabled: dto.enabled ?? true,
        priority: dto.priority ?? 100,
      })
      .select('*')
      .single();
    if (error || !data) {
      this.logger.error(`create rule falhou: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Falha ao criar rule');
    }
    return data as AlertRoutingRule;
  }

  async update(
    orgId: string,
    actorRole: OrgMemberRole,
    ruleId: string,
    dto: UpdateRoutingRuleDto,
  ): Promise<AlertRoutingRule> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException(
        'Apenas owner/admin podem editar regras de roteamento.',
      );
    }
    const patch: Record<string, unknown> = {};
    for (const k of [
      'name',
      'signal_type',
      'min_severity',
      'manager_ids',
      'delivery_mode',
      'business_hours_only',
      'enabled',
      'priority',
    ] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    if (Object.keys(patch).length === 0) {
      return this.getOrThrow(orgId, ruleId);
    }
    const { data, error } = await this.supabase.adminClient
      .from('alert_routing_rules')
      .update(patch)
      .eq('id', ruleId)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error || !data) {
      this.logger.error(`update rule falhou: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Falha ao atualizar');
    }
    return data as AlertRoutingRule;
  }

  async remove(
    orgId: string,
    actorRole: OrgMemberRole,
    ruleId: string,
  ): Promise<void> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException(
        'Apenas owner/admin podem remover regras de roteamento.',
      );
    }
    const { error } = await this.supabase.adminClient
      .from('alert_routing_rules')
      .delete()
      .eq('id', ruleId)
      .eq('org_id', orgId);
    if (error) {
      this.logger.error(`delete rule falhou: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  // ────────────────────────────────────────────
  // Matching engine (consumido por AlertEngine)
  // ────────────────────────────────────────────

  /**
   * Resolve quem recebe um signal específico baseado nas rules enabled.
   * Retorna lista deduplicada por manager_id (rule de menor priority vence).
   */
  async resolveRecipients(
    orgId: string,
    signal: SignalForRouting,
  ): Promise<ResolvedRecipient[]> {
    const rules = await this.list(orgId);
    const enabled = rules.filter((r) => r.enabled);

    const matching = enabled.filter((r) => {
      const typeMatch = r.signal_type === '*' || r.signal_type === signal.signal_type;
      if (!typeMatch) return false;
      return SEVERITY_RANK[signal.severity] >= SEVERITY_RANK[r.min_severity];
    });

    // Já vem ordenado por priority asc do list()
    const seenManager = new Set<string>();
    const out: ResolvedRecipient[] = [];
    for (const r of matching) {
      for (const mid of r.manager_ids) {
        if (seenManager.has(mid)) continue;
        seenManager.add(mid);
        out.push({
          manager_id: mid,
          delivery_mode: r.delivery_mode,
          business_hours_only: r.business_hours_only,
          rule_id: r.id,
        });
      }
    }
    return out;
  }

  // ────────────────────────────────────────────
  // Privates
  // ────────────────────────────────────────────

  private async getOrThrow(orgId: string, ruleId: string): Promise<AlertRoutingRule> {
    const { data, error } = await this.supabase.adminClient
      .from('alert_routing_rules')
      .select('*')
      .eq('id', ruleId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Rule não encontrada.');
    return data as AlertRoutingRule;
  }
}
