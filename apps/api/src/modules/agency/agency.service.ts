import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';

export interface OrgWithSummary {
  org_id: string;
  org_name: string;
  user_role: string;
  social: {
    pending_approval: number;
    scheduled_next_7d: number;
    drafts: number;
    published_this_month: number;
    total_brands: number;
  };
  unread_signals: number;
}

/**
 * Service que retorna o panorama agregado das orgs do usuário pra
 * agências/operadores que gerenciam múltiplas orgs.
 *
 * Estratégia: bypassa o RLS via adminClient (service-role) e filtra
 * via subquery em org_members.user_id. Cada usuário só vê orgs onde
 * tem membership ativa.
 */
@Injectable()
export class AgencyService {
  private readonly log = new Logger(AgencyService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async listOrgsForUser(userId: string): Promise<OrgWithSummary[]> {
    // 1. Buscar todas as orgs do user via org_members
    const { data: memberships } = await this.supabase.adminClient
      .from('org_members')
      .select('org_id, role, status, organizations(id, name)')
      .eq('user_id', userId)
      .eq('status', 'active');

    // PostgREST retorna FK como array mesmo em 1:1; normalizamos
    const rows = (memberships ?? []).map((m) => {
      const raw = m as {
        org_id: string;
        role: string;
        status: string;
        organizations: Array<{ id: string; name: string }> | { id: string; name: string } | null;
      };
      const org = Array.isArray(raw.organizations)
        ? raw.organizations[0] ?? null
        : raw.organizations;
      return {
        org_id: raw.org_id,
        role: raw.role,
        status: raw.status,
        organizations: org,
      };
    });

    if (rows.length === 0) return [];

    // 2. Pra cada org, agrega métricas em paralelo (best-effort)
    const out = await Promise.all(
      rows.map(async (m) => {
        if (!m.organizations) return null;
        try {
          const [socialDash, brandsCount, signalsCount] = await Promise.all([
            this.fetchSocialDash(m.org_id),
            this.countBrands(m.org_id),
            this.countUnackedSignals(m.org_id),
          ]);
          return {
            org_id: m.org_id,
            org_name: m.organizations.name,
            user_role: m.role,
            social: { ...socialDash, total_brands: brandsCount },
            unread_signals: signalsCount,
          } satisfies OrgWithSummary;
        } catch (err) {
          this.log.warn(`agg falhou pra org ${m.org_id}: ${String(err)}`);
          return {
            org_id: m.org_id,
            org_name: m.organizations.name,
            user_role: m.role,
            social: {
              pending_approval: 0,
              scheduled_next_7d: 0,
              drafts: 0,
              published_this_month: 0,
              total_brands: 0,
            },
            unread_signals: 0,
          };
        }
      }),
    );

    return out.filter((x): x is OrgWithSummary => x !== null);
  }

  // ─── helpers ────────────────────────────────────

  private async fetchSocialDash(orgId: string): Promise<{
    pending_approval: number;
    scheduled_next_7d: number;
    drafts: number;
    published_this_month: number;
  }> {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const next7d = new Date(Date.now() + 7 * 86_400_000);

    const { data } = await this.supabase.adminClient
      .from('social_contents')
      .select('status, scheduled_for, published_at')
      .eq('org_id', orgId)
      .limit(2000);
    const rows = (data ?? []) as Array<{
      status: string;
      scheduled_for: string | null;
      published_at: string | null;
    }>;

    return {
      pending_approval: rows.filter((r) => r.status === 'pending_approval')
        .length,
      scheduled_next_7d: rows.filter(
        (r) =>
          r.status === 'scheduled' &&
          r.scheduled_for &&
          new Date(r.scheduled_for) <= next7d,
      ).length,
      drafts: rows.filter((r) => r.status === 'draft').length,
      published_this_month: rows.filter(
        (r) => r.published_at && new Date(r.published_at) >= monthStart,
      ).length,
    };
  }

  private async countBrands(orgId: string): Promise<number> {
    const { count } = await this.supabase.adminClient
      .from('social_brands')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_active', true);
    return count ?? 0;
  }

  private async countUnackedSignals(orgId: string): Promise<number> {
    const { count } = await this.supabase.adminClient
      .from('social_signals')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .is('acknowledged_at', null);
    return count ?? 0;
  }
}
