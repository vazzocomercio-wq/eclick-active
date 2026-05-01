import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';

// ──────────────────────────────────────────────────────────
// Tipos da response
// ──────────────────────────────────────────────────────────

export interface MetricCounts {
  unread_conversations: number;
  hot_leads: number;
  pipeline_value: number;
  pending_tasks_today: number;
}

export type AttentionItemKind =
  | 'unanswered_conversation'
  | 'sla_breached_deal'
  | 'overdue_task'
  | 'high_risk_deal';

export interface AttentionItem {
  id: string;
  kind: AttentionItemKind;
  title: string;
  description: string;
  /** ISO timestamp anchor used to compute "X tempo atrás" no front */
  since: string;
  /** Onde clicar leva o vendedor */
  href: string;
  /** Severity badge (urgente/alta/media/baixa) */
  severity: 'urgent' | 'high' | 'medium';
  /** ID do registro relacionado (deal_id, conversation_id, task_id) */
  ref_id: string;
}

export interface HotLeadItem {
  id: string;
  name: string | null;
  avatar_url: string | null;
  temperature: 'cold' | 'warm' | 'hot' | 'very_hot' | null;
  score: number;
  last_message_preview: string | null;
  last_message_at: string | null;
  conversation_id: string | null;
}

export interface TopDealItem {
  id: string;
  title: string;
  value: number;
  currency: string;
  contact_name: string | null;
  stage_name: string;
  stage_color: string;
  ai_close_probability: number | null;
}

export type RecentActivityKind =
  | 'message_received'
  | 'message_sent'
  | 'deal_stage_changed'
  | 'deal_won'
  | 'deal_lost'
  | 'task_completed'
  | 'note_added'
  | 'other';

export interface RecentActivityItem {
  id: string;
  kind: RecentActivityKind;
  title: string;
  description: string | null;
  contact_name: string | null;
  created_at: string;
  href: string | null;
}

export interface DashboardSummary {
  metrics: MetricCounts;
  attention: AttentionItem[];
  hot_leads: HotLeadItem[];
  top_deals: TopDealItem[];
  recent_activity: RecentActivityItem[];
}

// ──────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────

const HOT_TEMPERATURES = ['hot', 'very_hot'] as const;
const HIGH_RISK_LEVELS = ['high', 'critical'] as const;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getSummary(orgId: string): Promise<DashboardSummary> {
    const [
      metrics,
      attention,
      hotLeads,
      topDeals,
      recentActivity,
    ] = await Promise.all([
      this.getMetrics(orgId),
      this.getAttentionItems(orgId),
      this.getHotLeads(orgId),
      this.getTopDeals(orgId),
      this.getRecentActivity(orgId),
    ]);

    return { metrics, attention, hot_leads: hotLeads, top_deals: topDeals, recent_activity: recentActivity };
  }

  // ────────────────────────────────────────────
  // Bloco 1 — Métricas
  // ────────────────────────────────────────────

  private async getMetrics(orgId: string): Promise<MetricCounts> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    const [
      unreadResp,
      hotLeadsResp,
      pipelineResp,
      tasksResp,
    ] = await Promise.all([
      this.supabase.adminClient
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .gt('unread_count', 0),
      this.supabase.adminClient
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .in('temperature', HOT_TEMPERATURES as unknown as string[]),
      this.supabase.adminClient
        .from('deals')
        .select('value')
        .eq('org_id', orgId)
        .is('won_at', null)
        .is('lost_at', null),
      this.supabase.adminClient
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('status', 'pending')
        .lte('due_date', endOfDay.toISOString()),
    ]);

    if (unreadResp.error) {
      this.logger.error(`metrics unread failed: ${unreadResp.error.message}`);
    }
    if (hotLeadsResp.error) {
      this.logger.error(`metrics hot_leads failed: ${hotLeadsResp.error.message}`);
    }
    if (pipelineResp.error) {
      this.logger.error(`metrics pipeline_value failed: ${pipelineResp.error.message}`);
    }
    if (tasksResp.error) {
      this.logger.error(`metrics pending_tasks failed: ${tasksResp.error.message}`);
    }

    const pipelineValue = (pipelineResp.data ?? []).reduce(
      (acc: number, row: { value: number | null }) => acc + Number(row.value ?? 0),
      0,
    );

    return {
      unread_conversations: unreadResp.count ?? 0,
      hot_leads: hotLeadsResp.count ?? 0,
      pipeline_value: pipelineValue,
      pending_tasks_today: tasksResp.count ?? 0,
    };
  }

  // ────────────────────────────────────────────
  // Bloco 2 — Itens de atenção (priorizados)
  // ────────────────────────────────────────────

  private async getAttentionItems(orgId: string): Promise<AttentionItem[]> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    const [unanswered, slaBreached, overdueTasks, highRisk] = await Promise.all([
      // Conversas com inbound sem resposta há mais de 1h.
      // Heurística: last_message_at antigo + first_response_at NULL OR < last_message_at.
      this.supabase.adminClient
        .from('conversations')
        .select(
          'id, last_message_at, first_response_at, contacts:contact_id(name, phone)',
        )
        .eq('org_id', orgId)
        .eq('status', 'open')
        .lt('last_message_at', oneHourAgo)
        .gt('unread_count', 0)
        .order('last_message_at', { ascending: true })
        .limit(10),
      // Deals ativos com SLA estourado (via view v_deal_board)
      this.supabase.adminClient
        .from('v_deal_board')
        .select('id, title, hours_in_stage, sla_hours, stage_name, contact_name')
        .eq('org_id', orgId)
        .eq('sla_breached', true)
        .order('hours_in_stage', { ascending: false })
        .limit(10),
      // Tasks overdue
      this.supabase.adminClient
        .from('tasks')
        .select('id, title, due_date, deal_id, contact_id, priority')
        .eq('org_id', orgId)
        .eq('status', 'pending')
        .lt('due_date', nowIso)
        .order('due_date', { ascending: true })
        .limit(10),
      // Deals com ai_risk high/critical
      this.supabase.adminClient
        .from('v_deal_board')
        .select('id, title, ai_risk, contact_name, stage_name')
        .eq('org_id', orgId)
        .in('ai_risk', HIGH_RISK_LEVELS as unknown as string[])
        .order('ai_score', { ascending: true })
        .limit(10),
    ]);

    const items: AttentionItem[] = [];

    if (!unanswered.error && unanswered.data) {
      for (const row of unanswered.data as unknown as Array<{
        id: string;
        last_message_at: string;
        contacts: { name: string | null; phone: string | null } | Array<{ name: string | null; phone: string | null }> | null;
      }>) {
        const contact = Array.isArray(row.contacts) ? row.contacts[0] ?? null : row.contacts;
        const who = contact?.name ?? contact?.phone ?? 'Contato';
        items.push({
          id: `conv:${row.id}`,
          kind: 'unanswered_conversation',
          title: `${who} aguardando resposta`,
          description: 'Mensagem inbound sem resposta há mais de 1h',
          since: row.last_message_at,
          href: `/conversas?conversation=${row.id}`,
          severity: 'urgent',
          ref_id: row.id,
        });
      }
    }

    if (!slaBreached.error && slaBreached.data) {
      for (const row of slaBreached.data as Array<{
        id: string;
        title: string;
        hours_in_stage: number;
        sla_hours: number | null;
        stage_name: string;
        contact_name: string | null;
      }>) {
        const hours = Math.round(row.hours_in_stage);
        items.push({
          id: `deal-sla:${row.id}`,
          kind: 'sla_breached_deal',
          title: row.title,
          description: `${hours}h em "${row.stage_name}" — SLA ${row.sla_hours}h`,
          since: new Date(Date.now() - row.hours_in_stage * 3600 * 1000).toISOString(),
          href: `/funis?deal=${row.id}`,
          severity: 'high',
          ref_id: row.id,
        });
      }
    }

    if (!overdueTasks.error && overdueTasks.data) {
      for (const row of overdueTasks.data as Array<{
        id: string;
        title: string;
        due_date: string;
        priority: string;
      }>) {
        items.push({
          id: `task:${row.id}`,
          kind: 'overdue_task',
          title: row.title,
          description: 'Tarefa atrasada',
          since: row.due_date,
          href: `/tarefas?task=${row.id}`,
          severity: row.priority === 'urgent' ? 'urgent' : 'high',
          ref_id: row.id,
        });
      }
    }

    if (!highRisk.error && highRisk.data) {
      for (const row of highRisk.data as Array<{
        id: string;
        title: string;
        ai_risk: 'high' | 'critical';
        contact_name: string | null;
        stage_name: string;
      }>) {
        items.push({
          id: `deal-risk:${row.id}`,
          kind: 'high_risk_deal',
          title: row.title,
          description: `Risco ${row.ai_risk === 'critical' ? 'crítico' : 'alto'} em "${row.stage_name}"`,
          since: new Date().toISOString(),
          href: `/funis?deal=${row.id}`,
          severity: row.ai_risk === 'critical' ? 'urgent' : 'medium',
          ref_id: row.id,
        });
      }
    }

    // Ordena por severidade (urgent > high > medium) e depois por "since" mais antigo
    const severityRank: Record<AttentionItem['severity'], number> = {
      urgent: 0,
      high: 1,
      medium: 2,
    };
    items.sort((a, b) => {
      const sev = severityRank[a.severity] - severityRank[b.severity];
      if (sev !== 0) return sev;
      return a.since.localeCompare(b.since);
    });

    return items.slice(0, 5);
  }

  // ────────────────────────────────────────────
  // Bloco 3 — Hot leads (top 5)
  // ────────────────────────────────────────────

  private async getHotLeads(orgId: string): Promise<HotLeadItem[]> {
    const { data: contacts, error } = await this.supabase.adminClient
      .from('contacts')
      .select('id, name, avatar_url, temperature, score')
      .eq('org_id', orgId)
      .in('temperature', HOT_TEMPERATURES as unknown as string[])
      .order('score', { ascending: false })
      .limit(5);

    if (error || !contacts) {
      this.logger.error(`hot_leads failed: ${error?.message}`);
      return [];
    }

    const contactIds = (contacts as Array<{ id: string }>).map((c) => c.id);
    if (contactIds.length === 0) return [];

    // Última conversa por contato (pega a mais recente)
    const { data: convs } = await this.supabase.adminClient
      .from('conversations')
      .select('id, contact_id, last_message_at')
      .eq('org_id', orgId)
      .in('contact_id', contactIds)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    const lastConvByContact = new Map<string, { id: string; last_message_at: string | null }>();
    for (const conv of (convs ?? []) as Array<{
      id: string;
      contact_id: string;
      last_message_at: string | null;
    }>) {
      if (!lastConvByContact.has(conv.contact_id)) {
        lastConvByContact.set(conv.contact_id, {
          id: conv.id,
          last_message_at: conv.last_message_at,
        });
      }
    }

    // Última mensagem inbound preview por conversa
    const convIds = Array.from(lastConvByContact.values()).map((c) => c.id);
    const previewByConv = new Map<string, string>();
    if (convIds.length > 0) {
      const { data: msgs } = await this.supabase.adminClient
        .from('messages')
        .select('conversation_id, plain_text, created_at')
        .eq('org_id', orgId)
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false })
        .limit(50);

      for (const m of (msgs ?? []) as Array<{
        conversation_id: string;
        plain_text: string | null;
      }>) {
        if (!previewByConv.has(m.conversation_id) && m.plain_text) {
          previewByConv.set(m.conversation_id, m.plain_text.slice(0, 80));
        }
      }
    }

    return (contacts as Array<{
      id: string;
      name: string | null;
      avatar_url: string | null;
      temperature: 'cold' | 'warm' | 'hot' | 'very_hot' | null;
      score: number;
    }>).map((c) => {
      const conv = lastConvByContact.get(c.id);
      return {
        id: c.id,
        name: c.name,
        avatar_url: c.avatar_url,
        temperature: c.temperature,
        score: c.score,
        last_message_preview: conv ? (previewByConv.get(conv.id) ?? null) : null,
        last_message_at: conv?.last_message_at ?? null,
        conversation_id: conv?.id ?? null,
      };
    });
  }

  // ────────────────────────────────────────────
  // Bloco 4 — Deals próximos de fechar (top 5)
  // ────────────────────────────────────────────

  private async getTopDeals(orgId: string): Promise<TopDealItem[]> {
    const { data, error } = await this.supabase.adminClient
      .from('v_deal_board')
      .select(
        'id, title, value, currency, contact_name, stage_name, stage_color, ai_close_probability',
      )
      .eq('org_id', orgId)
      .not('ai_close_probability', 'is', null)
      .order('ai_close_probability', { ascending: false })
      .limit(5);

    if (error) {
      this.logger.error(`top_deals failed: ${error.message}`);
      return [];
    }

    return (data ?? []) as TopDealItem[];
  }

  // ────────────────────────────────────────────
  // Bloco 5 — Atividade recente (mix de fontes)
  // ────────────────────────────────────────────

  private async getRecentActivity(orgId: string): Promise<RecentActivityItem[]> {
    const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [dealActsResp, contactTimelineResp] = await Promise.all([
      this.supabase.adminClient
        .from('deal_activities')
        .select(
          'id, deal_id, activity_type, title, description, created_at, deals:deal_id(title, contact_id, contacts:contact_id(name))',
        )
        .eq('org_id', orgId)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(15),
      this.supabase.adminClient
        .from('contact_timeline')
        .select(
          'id, contact_id, event_type, title, description, created_at, contacts:contact_id(name)',
        )
        .eq('org_id', orgId)
        .gte('created_at', sinceIso)
        .in('event_type', [
          'message_received',
          'message_sent',
          'task_completed',
          'note_added',
          'deal_won',
          'deal_lost',
        ])
        .order('created_at', { ascending: false })
        .limit(15),
    ]);

    const items: RecentActivityItem[] = [];

    if (!dealActsResp.error && dealActsResp.data) {
      for (const row of dealActsResp.data as unknown as Array<{
        id: string;
        deal_id: string;
        activity_type: string;
        title: string | null;
        description: string | null;
        created_at: string;
        deals:
          | { title: string; contacts: { name: string | null } | Array<{ name: string | null }> | null }
          | Array<{ title: string; contacts: { name: string | null } | Array<{ name: string | null }> | null }>
          | null;
      }>) {
        const deal = Array.isArray(row.deals) ? row.deals[0] ?? null : row.deals;
        const dealContact = deal
          ? Array.isArray(deal.contacts)
            ? deal.contacts[0] ?? null
            : deal.contacts
          : null;
        const kind = mapDealActivityKind(row.activity_type);
        items.push({
          id: `da:${row.id}`,
          kind,
          title: row.title ?? deal?.title ?? 'Atividade do negócio',
          description: row.description,
          contact_name: dealContact?.name ?? null,
          created_at: row.created_at,
          href: `/funis?deal=${row.deal_id}`,
        });
      }
    }

    if (!contactTimelineResp.error && contactTimelineResp.data) {
      for (const row of contactTimelineResp.data as unknown as Array<{
        id: string;
        contact_id: string;
        event_type: string;
        title: string | null;
        description: string | null;
        created_at: string;
        contacts: { name: string | null } | Array<{ name: string | null }> | null;
      }>) {
        const contact = Array.isArray(row.contacts) ? row.contacts[0] ?? null : row.contacts;
        const kind = mapTimelineKind(row.event_type);
        items.push({
          id: `ct:${row.id}`,
          kind,
          title: row.title ?? defaultTimelineTitle(row.event_type),
          description: row.description,
          contact_name: contact?.name ?? null,
          created_at: row.created_at,
          href: `/contatos/${row.contact_id}`,
        });
      }
    }

    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return items.slice(0, 10);
  }
}

// ──────────────────────────────────────────────────────────
// Helpers de mapeamento
// ──────────────────────────────────────────────────────────

function mapDealActivityKind(type: string): RecentActivityKind {
  if (type === 'stage_changed') return 'deal_stage_changed';
  if (type === 'deal_won' || type === 'won') return 'deal_won';
  if (type === 'deal_lost' || type === 'lost') return 'deal_lost';
  if (type === 'note_added') return 'note_added';
  return 'other';
}

function mapTimelineKind(eventType: string): RecentActivityKind {
  if (eventType === 'message_received') return 'message_received';
  if (eventType === 'message_sent') return 'message_sent';
  if (eventType === 'task_completed') return 'task_completed';
  if (eventType === 'note_added') return 'note_added';
  if (eventType === 'deal_won') return 'deal_won';
  if (eventType === 'deal_lost') return 'deal_lost';
  return 'other';
}

function defaultTimelineTitle(eventType: string): string {
  const map: Record<string, string> = {
    message_received: 'Mensagem recebida',
    message_sent: 'Mensagem enviada',
    task_completed: 'Tarefa concluída',
    note_added: 'Nota adicionada',
    deal_won: 'Negócio ganho',
    deal_lost: 'Negócio perdido',
  };
  return map[eventType] ?? 'Atividade';
}
