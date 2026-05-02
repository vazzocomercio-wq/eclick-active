import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { EventsGateway } from '../../gateways/events.gateway';
import { AnthropicClient } from './anthropic.client';

export interface TransferBriefing {
  generated_at: string;
  reason: string;
  customer: {
    name: string | null;
    phone: string | null;
    channel: string;
  };
  conversation: {
    id: string;
    started_at: string;
    message_count: number;
  };
  ai_summary: string | null;
  ai_intent: string | null;
  ai_sentiment: string | null;
  ai_temperature: string | null;
  customer_wants: string;
  objections: string[];
  collected_data: string[];
  missing_data: string[];
  products_of_interest: string[];
  approach_suggestion: string;
}

export interface InitiateTransferOpts {
  reason: string;
  target_user_id?: string;
  /** Quando true, não transfere imediatamente — manda mensagem perguntando */
  ask_permission?: boolean;
}

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly anthropic: AnthropicClient,
    private readonly events: EventsGateway,
  ) {}

  // ──────────────────────────────────────────────────────────
  // initiateTransfer
  // ──────────────────────────────────────────────────────────

  async initiateTransfer(
    orgId: string,
    conversationId: string,
    opts: InitiateTransferOpts,
  ): Promise<{ status: 'pending_permission' | 'transferred'; briefing?: TransferBriefing }> {
    const conv = await this.fetchConversation(orgId, conversationId);

    if (opts.ask_permission) {
      // Salva pending_transfer no metadata e gera msg pra cliente
      const targetName = await this.resolveTargetName(orgId, opts.target_user_id);
      const message = await this.generatePermissionMessage(orgId, opts.reason, targetName);

      const newMetadata = {
        ...(conv.metadata as Record<string, unknown>),
        pending_transfer: {
          target_user_id: opts.target_user_id ?? null,
          reason: opts.reason,
          asked_at: new Date().toISOString(),
          message,
        },
      };

      await this.supabase.adminClient
        .from('conversations')
        .update({ metadata: newMetadata })
        .eq('org_id', orgId)
        .eq('id', conversationId);

      // Caller pode buscar a mensagem via metadata e enviar pelo channel
      return { status: 'pending_permission' };
    }

    // Transferência imediata
    const briefing = await this.buildBriefing(orgId, conversationId, opts.reason);
    const targetUserId = opts.target_user_id ?? (await this.resolveRoundRobinAgent(orgId));

    const newMetadata = {
      ...(conv.metadata as Record<string, unknown>),
      transfer_briefing: briefing,
      pending_transfer: null,
    };

    const updates: Record<string, unknown> = {
      assigned_to: targetUserId,
      metadata: newMetadata,
    };

    await this.supabase.adminClient
      .from('conversations')
      .update(updates)
      .eq('org_id', orgId)
      .eq('id', conversationId);

    // Notificação urgente
    if (targetUserId) {
      await this.supabase.adminClient.from('notifications').insert({
        org_id: orgId,
        user_id: targetUserId,
        type: 'conversation_transferred',
        severity: 'urgent',
        title: 'Conversa transferida',
        body: `${briefing.customer.name ?? 'Contato'} — ${opts.reason}`,
        link: `/conversas?id=${conversationId}`,
        metadata: { conversation_id: conversationId, briefing_reason: opts.reason },
      });

      // Tarefa pra agente
      await this.supabase.adminClient.from('tasks').insert({
        org_id: orgId,
        title: `Atender transferência de ${briefing.customer.name ?? 'cliente'}`,
        description: `Motivo: ${opts.reason}\n\nBriefing salvo na conversa.`,
        task_type: 'follow_up',
        priority: 'urgent',
        status: 'pending',
        assigned_to: targetUserId,
        conversation_id: conversationId,
        contact_id: conv.contact_id,
        created_by_ai: true,
        ai_context: `Transferência via IA — ${opts.reason}`,
      });
    }

    // Timeline
    if (conv.contact_id) {
      await this.supabase.adminClient
        .from('contact_timeline')
        .insert({
          org_id: orgId,
          contact_id: conv.contact_id,
          event_type: 'transferred',
          title: 'Conversa transferida',
          description: `Motivo: ${opts.reason}`,
          metadata: { conversation_id: conversationId, target_user_id: targetUserId },
        })
        .then(() => {})
        .then(undefined, () => {});
    }

    return { status: 'transferred', briefing };
  }

  // ──────────────────────────────────────────────────────────
  // handleTransferResponse — analisa resposta a pedido de permissão
  // ──────────────────────────────────────────────────────────

  /**
   * Quando a conversa tem `pending_transfer` no metadata, classifica
   * a próxima mensagem do cliente como aceito/recusado.
   */
  async handleTransferResponse(
    orgId: string,
    conversationId: string,
    clientMessage: string,
  ): Promise<{ accepted: boolean; resolved: boolean }> {
    const conv = await this.fetchConversation(orgId, conversationId);
    const metadata = (conv.metadata as Record<string, unknown>) ?? {};
    const pending = metadata.pending_transfer as
      | { target_user_id: string | null; reason: string }
      | null
      | undefined;

    if (!pending) return { accepted: false, resolved: false };

    const accepted = await this.classifyAcceptance(orgId, clientMessage);

    if (accepted) {
      await this.initiateTransfer(orgId, conversationId, {
        reason: pending.reason,
        ask_permission: false,
        ...(pending.target_user_id ? { target_user_id: pending.target_user_id } : {}),
      });
    } else {
      // Cancela pending — continua conversa normal
      const cleanedMetadata = { ...metadata, pending_transfer: null };
      await this.supabase.adminClient
        .from('conversations')
        .update({ metadata: cleanedMetadata })
        .eq('org_id', orgId)
        .eq('id', conversationId);
    }

    return { accepted, resolved: true };
  }

  // ──────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────

  private async fetchConversation(orgId: string, conversationId: string) {
    const { data, error } = await this.supabase.adminClient
      .from('conversations')
      .select('id, contact_id, channel_type, status, metadata, ai_summary, ai_intent, ai_sentiment, ai_temperature, message_count, created_at')
      .eq('org_id', orgId)
      .eq('id', conversationId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Conversa ${conversationId} não encontrada`);
    return data as {
      id: string;
      contact_id: string | null;
      channel_type: string;
      status: string;
      metadata: Record<string, unknown> | null;
      ai_summary: string | null;
      ai_intent: string | null;
      ai_sentiment: string | null;
      ai_temperature: string | null;
      message_count: number;
      created_at: string;
    };
  }

  private async resolveTargetName(orgId: string, userId?: string): Promise<string | null> {
    if (!userId) return null;
    const { data } = await this.supabase.adminClient
      .from('org_members')
      .select('display_name')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();
    return ((data as { display_name: string | null } | null)?.display_name ?? null) as string | null;
  }

  /**
   * Round-robin simples — pega o agente com menos conversas atribuídas.
   */
  private async resolveRoundRobinAgent(orgId: string): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('org_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .in('role', ['owner', 'admin', 'agent']);
    const userIds = ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
    if (userIds.length === 0) return null;
    return userIds[0] ?? null;
  }

  private async generatePermissionMessage(
    orgId: string,
    reason: string,
    targetName: string | null,
  ): Promise<string> {
    const userPrompt = `Gere UMA mensagem em PT-BR pedindo permissão pro cliente pra transferi-lo a ${targetName ?? 'um especialista'} pra resolver: ${reason}. Tom: educado e direto. Inclua pergunta tipo "tudo bem?" ou "posso seguir?". Texto plano, sem aspas.`;
    try {
      const { data } = await this.anthropic.complete<string>({
        interaction_type: 'suggest_response',
        org_id: orgId,
        system: 'Você gera mensagens curtas, educadas e diretas em PT-BR. Sem aspas, sem prefixos.',
        user: userPrompt,
        max_tokens: 100,
      });
      return data.trim().replace(/^["']|["']$/g, '');
    } catch {
      return `Vou transferir você para ${targetName ?? 'um especialista'} que pode te ajudar melhor com isso. Tudo bem?`;
    }
  }

  private async classifyAcceptance(orgId: string, message: string): Promise<boolean> {
    const schema = {
      type: 'object',
      properties: { accepted: { type: 'boolean' } },
      required: ['accepted'],
      additionalProperties: false,
    };
    try {
      const { data } = await this.anthropic.complete<{ accepted: boolean }>({
        interaction_type: 'classify_intent',
        org_id: orgId,
        system:
          'Classifique se a mensagem do cliente é uma aceitação ou recusa a uma transferência. Responda APENAS JSON: {"accepted": true} ou {"accepted": false}.',
        user: `Mensagem do cliente: "${message}"`,
        schema,
        max_tokens: 50,
      });
      return !!data.accepted;
    } catch {
      // Fallback heurística simples
      const m = message.toLowerCase();
      return /\b(sim|ok|tudo bem|claro|pode|aceito|beleza|fechou|vamos)\b/.test(m);
    }
  }

  private async buildBriefing(
    orgId: string,
    conversationId: string,
    reason: string,
  ): Promise<TransferBriefing> {
    const conv = await this.fetchConversation(orgId, conversationId);

    let customerName: string | null = null;
    let customerPhone: string | null = null;
    if (conv.contact_id) {
      const { data } = await this.supabase.adminClient
        .from('contacts')
        .select('name, phone')
        .eq('org_id', orgId)
        .eq('id', conv.contact_id)
        .maybeSingle();
      const c = data as { name: string | null; phone: string | null } | null;
      customerName = c?.name ?? null;
      customerPhone = c?.phone ?? null;
    }

    // Carrega últimas 30 mensagens pra IA produzir wants/objeções/produtos/sugestão
    const { data: msgs } = await this.supabase.adminClient
      .from('messages')
      .select('direction, plain_text, content_type')
      .eq('org_id', orgId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(30);
    const recent = ((msgs ?? []) as Array<{ direction: string; plain_text: string | null; content_type: string }>).reverse();

    const transcript = recent
      .map((m) => {
        const who = m.direction === 'inbound' ? 'CLIENTE' : 'AGENTE';
        return `[${who}] ${m.plain_text ?? `[${m.content_type}]`}`;
      })
      .join('\n');

    const enrichSchema = {
      type: 'object',
      properties: {
        customer_wants: { type: 'string' },
        objections: { type: 'array', items: { type: 'string' } },
        products_of_interest: { type: 'array', items: { type: 'string' } },
        approach_suggestion: { type: 'string' },
      },
      required: ['customer_wants', 'objections', 'products_of_interest', 'approach_suggestion'],
      additionalProperties: false,
    };

    let enriched: {
      customer_wants: string;
      objections: string[];
      products_of_interest: string[];
      approach_suggestion: string;
    } = {
      customer_wants: '(não foi possível extrair)',
      objections: [],
      products_of_interest: [],
      approach_suggestion: 'Continuar a conversa do ponto onde parou.',
    };
    try {
      const { data } = await this.anthropic.complete<typeof enriched>({
        interaction_type: 'summarize',
        org_id: orgId,
        system:
          'Você produz briefings de transferência de atendimento. A partir do histórico, extraia: o que o cliente quer, objeções detectadas, produtos/serviços de interesse, e uma sugestão de próxima abordagem pro agente humano. Retorne APENAS JSON válido. Seja conciso e factual — não invente.',
        user: `Histórico da conversa:\n\n${transcript}\n\nMotivo da transferência: ${reason}`,
        schema: enrichSchema,
        max_tokens: 800,
      });
      enriched = {
        customer_wants: String(data.customer_wants ?? '').slice(0, 500),
        objections: Array.isArray(data.objections) ? data.objections : [],
        products_of_interest: Array.isArray(data.products_of_interest)
          ? data.products_of_interest
          : [],
        approach_suggestion: String(data.approach_suggestion ?? '').slice(0, 500),
      };
    } catch (err) {
      this.logger.warn(
        `briefing enrichment failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Detect collected vs missing (heurística baseada em campos do contato)
    let collected: string[] = [];
    const missing: string[] = [];
    if (conv.contact_id) {
      const { data } = await this.supabase.adminClient
        .from('contacts')
        .select('name, email, phone, company_name')
        .eq('org_id', orgId)
        .eq('id', conv.contact_id)
        .maybeSingle();
      const c = (data ?? {}) as Record<string, unknown>;
      collected = ['name', 'email', 'phone', 'company_name'].filter((f) => !!c[f]);
      const all = ['name', 'email', 'phone', 'company_name'];
      missing.push(...all.filter((f) => !c[f]));
    }

    return {
      generated_at: new Date().toISOString(),
      reason,
      customer: {
        name: customerName,
        phone: customerPhone,
        channel: conv.channel_type,
      },
      conversation: {
        id: conv.id,
        started_at: conv.created_at,
        message_count: conv.message_count,
      },
      ai_summary: conv.ai_summary,
      ai_intent: conv.ai_intent,
      ai_sentiment: conv.ai_sentiment,
      ai_temperature: conv.ai_temperature,
      customer_wants: enriched.customer_wants,
      objections: enriched.objections,
      collected_data: collected,
      missing_data: missing,
      products_of_interest: enriched.products_of_interest,
      approach_suggestion: enriched.approach_suggestion,
    };
  }
}
