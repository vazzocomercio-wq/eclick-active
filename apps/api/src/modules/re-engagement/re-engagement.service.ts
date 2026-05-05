import { Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import type { AiAgentPersona } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../common/channels/channel-dispatcher.service';
import { LlmService } from '../../common/llm/llm.service';
import { OutboundEventsService } from '../../common/messaging-realtime/outbound-events.service';
import { AiPersonaService } from '../ai-persona/ai-persona.service';

export interface ReEngagementSettings {
  enabled: boolean;
  /** Mínimo de dias desde última atividade pra elegibilidade (default 5). */
  days_threshold: number;
  /** Limite de re-tentativas por conversa (default 2). */
  max_retries: number;
  /** Se true, só reativa conversas com deal aberto (default true). */
  only_with_open_deal: boolean;
  /** Dias mínimos entre uma re-tentativa e a próxima (default 7). */
  min_advance_days_between: number;
}

export interface EligibleConversation {
  conversation_id: string;
  contact_id: string;
  contact_name: string | null;
  channel_id: string | null;
  last_activity_at: string;
  days_since_last_activity: number;
  retry_number: number;
  /** Resumo da última msg do contato pra dar contexto à IA. */
  last_inbound_text: string | null;
  /** Tags do deal aberto (se houver) — IA usa pra contextualizar follow-up. */
  deal_tags: string[];
}

export interface ReEngagementRunRow {
  id: string;
  org_id: string;
  conversation_id: string;
  contact_id: string;
  message_text: string;
  message_id: string | null;
  status: 'ok' | 'failed' | 'skipped';
  replied_at: string | null;
  error_message: string | null;
  days_since_last_activity: number;
  retry_number: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

const DEFAULT_SETTINGS: ReEngagementSettings = {
  enabled: false,
  days_threshold: 5,
  max_retries: 2,
  only_with_open_deal: true,
  min_advance_days_between: 7,
};

/**
 * Re-engagement de leads parados.
 *
 * Worker tica de hora em hora, lista conversas elegíveis e dispara mensagem
 * personalizada via Claude pra reativar. Best-effort:
 *   - Skipa se sem persona/canal/contato
 *   - Skipa se já tentou recentemente (min_advance_days_between)
 *   - Skipa se atingiu max_retries
 *
 * UI lista runs recentes em /configuracoes > Concierge.
 */
@Injectable()
export class ReEngagementService {
  private readonly logger = new Logger(ReEngagementService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly persona: AiPersonaService,
    private readonly llm: LlmService,
    private readonly outboundEvents: OutboundEventsService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // Settings
  // ──────────────────────────────────────────────────────────

  async getSettings(orgId: string): Promise<ReEngagementSettings> {
    const { data } = await this.supabase.adminClient
      .from('organizations')
      .select('settings')
      .eq('id', orgId)
      .maybeSingle();
    const settings = (data?.settings as Record<string, unknown> | null) ?? {};
    const re = (settings.re_engagement as Partial<ReEngagementSettings> | undefined) ?? {};
    return {
      enabled: re.enabled === true,
      days_threshold: typeof re.days_threshold === 'number' ? re.days_threshold : DEFAULT_SETTINGS.days_threshold,
      max_retries: typeof re.max_retries === 'number' ? re.max_retries : DEFAULT_SETTINGS.max_retries,
      only_with_open_deal:
        re.only_with_open_deal === undefined ? DEFAULT_SETTINGS.only_with_open_deal : re.only_with_open_deal === true,
      min_advance_days_between:
        typeof re.min_advance_days_between === 'number'
          ? re.min_advance_days_between
          : DEFAULT_SETTINGS.min_advance_days_between,
    };
  }

  async updateSettings(orgId: string, patch: Partial<ReEngagementSettings>): Promise<ReEngagementSettings> {
    const { data: existing } = await this.supabase.adminClient
      .from('organizations')
      .select('settings')
      .eq('id', orgId)
      .maybeSingle();
    const settings = ((existing?.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const re = (settings.re_engagement as Record<string, unknown> | undefined) ?? {};
    const newSettings = {
      ...settings,
      re_engagement: { ...re, ...patch },
    };
    await this.supabase.adminClient
      .from('organizations')
      .update({ settings: newSettings })
      .eq('id', orgId);
    return this.getSettings(orgId);
  }

  // ──────────────────────────────────────────────────────────
  // Listagem (UI)
  // ──────────────────────────────────────────────────────────

  async listRuns(orgId: string, limit = 50): Promise<ReEngagementRunRow[]> {
    const { data } = await this.supabase.adminClient
      .from('re_engagement_runs')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as ReEngagementRunRow[];
  }

  /**
   * Lista conversas elegíveis a re-engagement AGORA (preview pra UI). Não
   * dispara nenhuma mensagem — só cálculo. Usa as settings da org.
   */
  async listEligible(orgId: string, limit = 50): Promise<EligibleConversation[]> {
    const settings = await this.getSettings(orgId);
    return this.findEligibleConversations(orgId, settings, limit);
  }

  // ──────────────────────────────────────────────────────────
  // Worker tick — chamado pelo ReEngagementWorker
  // ──────────────────────────────────────────────────────────

  async runForOrg(orgId: string): Promise<{ processed: number; sent: number; skipped: number }> {
    const settings = await this.getSettings(orgId);
    if (!settings.enabled) return { processed: 0, sent: 0, skipped: 0 };

    const persona = await this.persona.getDefault(orgId).catch(() => null);
    if (!persona) {
      this.logger.debug(`re-engagement org=${orgId} sem persona default — skip`);
      return { processed: 0, sent: 0, skipped: 0 };
    }

    const eligible = await this.findEligibleConversations(orgId, settings, 25);
    if (eligible.length === 0) return { processed: 0, sent: 0, skipped: 0 };

    let sent = 0;
    let skipped = 0;

    for (const conv of eligible) {
      try {
        const ok = await this.attemptReEngage(orgId, conv, persona);
        if (ok) sent++;
        else skipped++;
      } catch (err) {
        this.logger.warn(
          `re-engage conv=${conv.conversation_id} crashed: ${err instanceof Error ? err.message : String(err)}`,
        );
        skipped++;
      }
    }

    return { processed: eligible.length, sent, skipped };
  }

  /**
   * Lista todas as orgs que têm re_engagement enabled. Usado pelo worker pra
   * descobrir o que processar.
   */
  async listEnabledOrgs(): Promise<string[]> {
    const { data } = await this.supabase.adminClient
      .from('organizations')
      .select('id, settings');
    const rows = (data ?? []) as Array<{ id: string; settings: Record<string, unknown> | null }>;
    return rows
      .filter((r) => {
        const re = (r.settings as { re_engagement?: { enabled?: boolean } } | null)?.re_engagement;
        return re?.enabled === true;
      })
      .map((r) => r.id);
  }

  // ──────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────

  private async findEligibleConversations(
    orgId: string,
    settings: ReEngagementSettings,
    limit: number,
  ): Promise<EligibleConversation[]> {
    const cutoff = new Date(Date.now() - settings.days_threshold * 86400_000).toISOString();
    const recentRetryCutoff = new Date(
      Date.now() - settings.min_advance_days_between * 86400_000,
    ).toISOString();

    // 1. Conversas paradas há > threshold dias
    const { data: convs } = await this.supabase.adminClient
      .from('conversations')
      .select('id, contact_id, channel_id, last_activity_at')
      .eq('org_id', orgId)
      .lte('last_activity_at', cutoff)
      .not('last_activity_at', 'is', null)
      .not('contact_id', 'is', null)
      .not('channel_id', 'is', null)
      .order('last_activity_at', { ascending: true })
      .limit(limit * 3); // pega mais pra filtrar depois

    const candidates = ((convs ?? []) as Array<{
      id: string;
      contact_id: string | null;
      channel_id: string | null;
      last_activity_at: string;
    }>).filter((c) => c.contact_id && c.channel_id);

    if (candidates.length === 0) return [];

    // 2. Filtra por: max_retries não atingido + sem retry recente
    const conversationIds = candidates.map((c) => c.id);
    const { data: priorRuns } = await this.supabase.adminClient
      .from('re_engagement_runs')
      .select('conversation_id, retry_number, created_at')
      .eq('org_id', orgId)
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: false });

    const runsByConv = new Map<
      string,
      Array<{ retry_number: number; created_at: string }>
    >();
    for (const r of (priorRuns ?? []) as Array<{
      conversation_id: string;
      retry_number: number;
      created_at: string;
    }>) {
      const list = runsByConv.get(r.conversation_id) ?? [];
      list.push({ retry_number: r.retry_number, created_at: r.created_at });
      runsByConv.set(r.conversation_id, list);
    }

    // 3. Se only_with_open_deal, busca deals abertos por contact
    let openDealsByContact = new Map<string, { tags: string[] }>();
    if (settings.only_with_open_deal) {
      const contactIds = candidates.map((c) => c.contact_id!).filter(Boolean);
      const { data: deals } = await this.supabase.adminClient
        .from('deals')
        .select('contact_id, tags')
        .eq('org_id', orgId)
        .in('contact_id', contactIds)
        .is('won_at', null)
        .is('lost_at', null);
      openDealsByContact = new Map(
        ((deals ?? []) as Array<{ contact_id: string; tags: string[] | null }>)
          .map((d) => [d.contact_id, { tags: d.tags ?? [] }] as const),
      );
    }

    // 4. Resolve nomes dos contatos + última msg inbound
    const contactIds = [...new Set(candidates.map((c) => c.contact_id!))];
    const { data: contacts } = await this.supabase.adminClient
      .from('contacts')
      .select('id, name')
      .eq('org_id', orgId)
      .in('id', contactIds);
    const contactNames = new Map(
      ((contacts ?? []) as Array<{ id: string; name: string | null }>).map(
        (c) => [c.id, c.name] as const,
      ),
    );

    // 5. Última msg inbound de cada conversa (best-effort, pega só 1ª)
    const lastInboundByConv = new Map<string, string>();
    const { data: lastMsgs } = await this.supabase.adminClient
      .from('messages')
      .select('conversation_id, plain_text, created_at')
      .eq('org_id', orgId)
      .eq('direction', 'inbound')
      .in('conversation_id', conversationIds)
      .not('plain_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(conversationIds.length * 3);
    for (const m of (lastMsgs ?? []) as Array<{
      conversation_id: string;
      plain_text: string | null;
    }>) {
      if (!lastInboundByConv.has(m.conversation_id) && m.plain_text) {
        lastInboundByConv.set(m.conversation_id, m.plain_text.slice(0, 300));
      }
    }

    const now = Date.now();
    const out: EligibleConversation[] = [];

    for (const c of candidates) {
      if (!c.contact_id) continue;

      const runs = runsByConv.get(c.id) ?? [];
      // Última tentativa muito recente?
      const last = runs[0];
      if (last && last.created_at > recentRetryCutoff) continue;
      // Atingiu o limite?
      if (runs.length >= settings.max_retries) continue;

      // Filtro de deal aberto
      let dealTags: string[] = [];
      if (settings.only_with_open_deal) {
        const open = openDealsByContact.get(c.contact_id);
        if (!open) continue;
        dealTags = open.tags;
      }

      const days = Math.floor((now - new Date(c.last_activity_at).getTime()) / 86400_000);
      out.push({
        conversation_id: c.id,
        contact_id: c.contact_id,
        contact_name: contactNames.get(c.contact_id) ?? null,
        channel_id: c.channel_id,
        last_activity_at: c.last_activity_at,
        days_since_last_activity: days,
        retry_number: runs.length + 1,
        last_inbound_text: lastInboundByConv.get(c.id) ?? null,
        deal_tags: dealTags,
      });

      if (out.length >= limit) break;
    }

    return out;
  }

  /**
   * Para uma conversa elegível, gera mensagem via Claude no estilo da
   * persona, persiste em messages, dispatch via canal e registra run.
   * Retorna true se sent ok.
   */
  private async attemptReEngage(
    orgId: string,
    conv: EligibleConversation,
    persona: AiAgentPersona,
  ): Promise<boolean> {
    if (!conv.channel_id) return false;

    const start = performance.now();
    const text = await this.generateMessage(persona, conv, orgId);
    if (!text) {
      await this.recordRun(orgId, conv, {
        text: '(falha ao gerar)',
        status: 'failed',
        error: 'IA retornou texto vazio',
      });
      return false;
    }

    // Persiste msg outbound
    const { data: persisted, error: persistErr } = await this.supabase.adminClient
      .from('messages')
      .insert({
        org_id: orgId,
        conversation_id: conv.conversation_id,
        direction: 'outbound',
        sender_type: 'bot',
        content_type: 'text',
        content: { body: text },
        plain_text: text,
        status: 'pending',
        metadata: {
          source: 're_engagement',
          retry_number: conv.retry_number,
        },
      })
      .select('id, created_at')
      .single();

    if (persistErr || !persisted) {
      await this.recordRun(orgId, conv, {
        text,
        status: 'failed',
        error: `persist: ${persistErr?.message ?? 'sem dados'}`,
      });
      return false;
    }
    const { id: messageId, created_at: messageCreatedAt } = persisted as {
      id: string;
      created_at: string;
    };

    try {
      const result = await this.dispatcher.send({
        org_id: orgId,
        channel_id: conv.channel_id,
        contact_id: conv.contact_id,
        content_type: 'text',
        content: { body: text },
      });
      await this.supabase.adminClient
        .from('messages')
        .update({ status: 'sent', channel_message_id: result.channel_message_id })
        .eq('org_id', orgId)
        .eq('id', messageId)
        .eq('created_at', messageCreatedAt);
      await this.outboundEvents.notifyOutbound({
        orgId,
        conversationId: conv.conversation_id,
        messageId,
        messageCreatedAt,
      });
      await this.recordRun(orgId, conv, { text, status: 'ok', messageId });
      this.logger.log(
        `re-engage ok org=${orgId} conv=${conv.conversation_id} retry=${conv.retry_number} took=${Math.round(performance.now() - start)}ms`,
      );
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.supabase.adminClient
        .from('messages')
        .update({
          status: 'failed',
          error_code: 're_engagement_dispatch_error',
          error_message: msg,
        })
        .eq('org_id', orgId)
        .eq('id', messageId)
        .eq('created_at', messageCreatedAt);
      await this.recordRun(orgId, conv, {
        text,
        status: 'failed',
        error: msg,
        messageId,
      });
      return false;
    }
  }

  private async generateMessage(
    persona: AiAgentPersona,
    conv: EligibleConversation,
    orgId: string,
  ): Promise<string | null> {
    const firstName = conv.contact_name
      ? (conv.contact_name.trim().split(/\s+/)[0] ?? conv.contact_name)
      : '';

    const tonePt = (() => {
      switch (persona.tone) {
        case 'formal':
          return 'formal e respeitoso';
        case 'casual':
          return 'descontraído';
        case 'friendly':
          return 'caloroso e empático';
        default:
          return 'profissional mas próximo';
      }
    })();

    const guidelinesText = (persona.guidelines ?? []).slice(0, 4).join('\n- ');
    const tagsText =
      conv.deal_tags.length > 0
        ? `Tags do deal aberto desse cliente: ${conv.deal_tags.slice(0, 8).join(', ')}.`
        : '(sem tags específicas)';

    const system = `Você é ${persona.name}, ${persona.role.replace(/_/g, ' ')} de uma empresa.
Tom: ${tonePt}.
${persona.personality ? `Personalidade: ${persona.personality}` : ''}
${guidelinesText ? `Diretrizes:\n- ${guidelinesText}` : ''}

Tarefa: gerar UMA mensagem CURTA (2-3 linhas, máx 240 chars) pra REATIVAR um lead que parou de responder há ${conv.days_since_last_activity} dias.

Tentativa #${conv.retry_number}.

A mensagem deve:
- Cumprimentar com naturalidade (use o primeiro nome se disponível)
- Referenciar o contexto anterior SEM pressão (sem cobrança, sem culpa)
- Fazer UMA pergunta convidativa que ajude a retomar
- Soar humana, não robótica nem comercial

Não use emojis em excesso (máx 1). Não comece com "Tudo bem?" genérico.

Retorne APENAS o texto da mensagem, sem aspas.`;

    const userMsg = `Cliente: ${conv.contact_name ? `${conv.contact_name} (chame de ${firstName})` : '(nome desconhecido — use linguagem neutra)'}
Última mensagem do cliente (há ${conv.days_since_last_activity} dias):
"${(conv.last_inbound_text ?? '(sem histórico de texto)').slice(0, 300)}"

${tagsText}

Tentativa #${conv.retry_number}. Gere a mensagem de re-engajamento.`;

    try {
      const res = await this.llm.chat({
        orgId,
        feature: 're_engagement',
        system,
        user: userMsg,
        max_tokens: 200,
        context: {
          conversation_id: conv.conversation_id,
          contact_id: conv.contact_id,
        },
        metadata: {
          source: 're_engagement_worker',
          retry_number: conv.retry_number,
        },
      });
      return res.text || null;
    } catch (err) {
      this.logger.warn(
        `generateMessage falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async recordRun(
    orgId: string,
    conv: EligibleConversation,
    payload: {
      text: string;
      status: 'ok' | 'failed' | 'skipped';
      error?: string;
      messageId?: string;
    },
  ): Promise<void> {
    await this.supabase.adminClient.from('re_engagement_runs').insert({
      org_id: orgId,
      conversation_id: conv.conversation_id,
      contact_id: conv.contact_id,
      message_text: payload.text,
      message_id: payload.messageId ?? null,
      status: payload.status,
      error_message: payload.error ?? null,
      days_since_last_activity: conv.days_since_last_activity,
      retry_number: conv.retry_number,
      metadata: {},
    });
  }
}
