import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../common/llm/llm.service';
import { BridgeService } from '../bridge/bridge.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { SacTemplatesService } from './sac-templates.service';
import type { SacAiClassification, SacTicket } from './sac.types';

const CLASSIFY_SYSTEM_PROMPT = `Você é um classificador de atendimentos SAC para CRMs brasileiros. Analise a mensagem do cliente e o contexto.

Considere: urgência do problema, sentimento do cliente, risco de reclamação pública, risco de mediação em marketplace, valor do pedido (se disponível), histórico do cliente.

Categorias: pre_sale, post_sale, order_status, delivery_delay, exchange, return, warranty, cancellation, refund, defective_product, wrong_product, missing_parts, invoice, payment, technical, complaint, mediation, negative_review, general.

Prioridades: low, normal, high, critical, reputation_risk.

Sentimentos: positive, neutral, frustrated, angry, very_angry.

Riscos reputacionais: none, low, medium, high, critical.

Se houver dados do pedido (atraso real vs reclamação infundada), use-os pra calibrar a classificação.

Retorne APENAS JSON válido com este shape:
{
  "category": "...",
  "subcategory": "...",
  "priority": "...",
  "sentiment": "...",
  "reputation_risk": "...",
  "risk_score": 0-100,
  "summary": "1 frase resumindo a issue",
  "resolution_suggestion": "1-2 frases com o que fazer",
  "suggested_response": "resposta sugerida em PT-BR",
  "confidence": 0-1
}`;

const SUGGEST_RESPONSE_PROMPT = `Você é um agente de SAC empático e resolutivo. Gere uma resposta em PT-BR para o cliente.

Diretrizes:
- Tom adequado ao sentimento (empático se irritado, direto se neutro)
- Use dados reais do pedido se disponíveis (rastreio, prazo, status)
- Respeite a persona da empresa (se fornecida)
- Seja conciso (2-4 frases) mas completo
- Nunca invente dados — se algo não foi fornecido, diga "vou verificar"

Retorne APENAS o texto da resposta, sem aspas nem prefixos.`;

const PERFORMANCE_SYSTEM_PROMPT = `Você é um analista de performance de SAC. Receba métricas agregadas e produza um diagnóstico em PT-BR.

Retorne JSON com:
{
  "summary": "1-2 frases resumindo a saúde do SAC",
  "main_issues": ["problema 1", "problema 2"],
  "recommendations": ["recomendação 1", ...],
  "products_with_problems": [{"sku": "...", "count": N}],
  "channels_with_problems": [{"channel": "...", "count": N}],
  "agents_needing_training": [{"agent_id": "...", "reason": "..."}]
}`;

@Injectable()
export class SacAiService {
  private readonly log = new Logger(SacAiService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly bridge: BridgeService,
    private readonly supabase: SupabaseService,
    private readonly templates: SacTemplatesService,
  ) {}

  /**
   * Classifica uma mensagem como ticket SAC. Inclui contexto de pedido
   * via bridge se disponível.
   */
  async classifyTicket(
    orgId: string,
    message: string,
    history: string[] = [],
    contactRefs: { phone?: string | null; email?: string | null } = {},
  ): Promise<SacAiClassification | null> {
    try {
      // Enriquecer com pedido se bridge ativo
      let orderContext = '';
      if (await this.bridge.hasSaasIntegration(orgId)) {
        const orders = await this.bridge.getOrdersByContact(orgId, {
          phone: contactRefs.phone ?? null,
          email: contactRefs.email ?? null,
          limit: 3,
        });
        if (orders.length > 0) {
          orderContext = `\n\nPedidos do cliente:\n${orders
            .map(
              (o) =>
                `- ${o.marketplace ?? '?'} #${o.marketplace_order_id ?? o.id} | status=${o.shipping_status ?? '?'} | prazo=${o.shipping_estimated_delivery ?? '?'} | valor=${o.total_amount ?? '?'}`,
            )
            .join('\n')}`;
        }
      }

      const userPrompt = [
        history.length ? `Histórico (recente):\n${history.slice(-5).join('\n')}` : '',
        `Mensagem atual do cliente:\n${message}`,
        orderContext,
      ]
        .filter(Boolean)
        .join('\n\n');

      const result = await this.llm.chat({
        orgId,
        feature: 'sac_classify',
        system: CLASSIFY_SYSTEM_PROMPT,
        user: userPrompt,
        json_mode: true,
        max_tokens: 800,
        temperature: 0.2,
      });

      return this.parseClassification(result.text);
    } catch (err) {
      this.log.warn(`classifyTicket falhou: ${String(err)}`);
      return null;
    }
  }

  /** Sugere resposta contextual pra um ticket. */
  async suggestResponse(orgId: string, ticketId: string): Promise<string | null> {
    try {
      const { data: ticket } = await this.supabase.adminClient
        .from('sac_tickets')
        .select('*')
        .eq('id', ticketId)
        .eq('org_id', orgId)
        .single();
      if (!ticket) return null;
      const t = ticket as SacTicket;

      const ctxLines = [
        `Categoria: ${t.category}`,
        `Prioridade: ${t.priority}`,
        t.ai_sentiment ? `Sentimento: ${t.ai_sentiment}` : '',
        t.ai_summary ? `Resumo: ${t.ai_summary}` : '',
        t.order_marketplace_id
          ? `Pedido: ${t.order_marketplace} #${t.order_marketplace_id} | status=${t.order_status ?? '?'} | rastreio=${t.order_tracking ?? '?'}`
          : '',
      ].filter(Boolean);

      // Últimas mensagens da conversa, se houver
      let lastMessages = '';
      if (t.conversation_id) {
        const { data: msgs } = await this.supabase.adminClient
          .from('messages')
          .select('direction, content, created_at')
          .eq('org_id', orgId)
          .eq('conversation_id', t.conversation_id)
          .order('created_at', { ascending: false })
          .limit(8);
        if (msgs && Array.isArray(msgs)) {
          lastMessages =
            '\n\nÚltimas mensagens:\n' +
            (msgs as Array<{ direction: string; content: string }>)
              .reverse()
              .map((m) => `${m.direction === 'inbound' ? 'Cliente' : 'Atendente'}: ${m.content}`)
              .join('\n');
        }
      }

      const result = await this.llm.chat({
        orgId,
        feature: 'sac_suggest_response',
        system: SUGGEST_RESPONSE_PROMPT,
        user: ctxLines.join('\n') + lastMessages,
        max_tokens: 400,
        temperature: 0.5,
      });

      return result.text.trim();
    } catch (err) {
      this.log.warn(`suggestResponse falhou: ${String(err)}`);
      return null;
    }
  }

  /** Diagnóstico de performance do SAC. */
  async analyzePerformance(
    orgId: string,
    period: 'today' | 'week' | 'month' = 'week',
  ): Promise<unknown> {
    const days = period === 'today' ? 1 : period === 'week' ? 7 : 30;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    try {
      const { data: tickets } = await this.supabase.adminClient
        .from('sac_tickets')
        .select(
          'category, priority, status, sla_breached, source_channel, order_data, customer_satisfaction, assigned_to, created_at, resolved_at',
        )
        .eq('org_id', orgId)
        .gte('created_at', since)
        .limit(2000);
      const rows = (tickets ?? []) as Array<Record<string, unknown>>;

      const summary = {
        total: rows.length,
        by_category: this.countBy(rows, 'category'),
        by_priority: this.countBy(rows, 'priority'),
        by_channel: this.countBy(rows, 'source_channel'),
        sla_breached: rows.filter((r) => r.sla_breached === true).length,
        avg_satisfaction: this.avg(rows, 'customer_satisfaction'),
      };

      const result = await this.llm.chat({
        orgId,
        feature: 'sac_performance',
        system: PERFORMANCE_SYSTEM_PROMPT,
        user: `Período: últimos ${days} dias\n\nMétricas:\n${JSON.stringify(summary, null, 2)}`,
        json_mode: true,
        max_tokens: 1200,
        temperature: 0.3,
      });

      return this.parseJson(result.text) ?? { summary, raw: result.text };
    } catch (err) {
      this.log.warn(`analyzePerformance falhou: ${String(err)}`);
      return { error: 'analysis_failed' };
    }
  }

  // ─── helpers ──────────────────────────────────────
  private parseClassification(raw: string): SacAiClassification | null {
    const parsed = this.parseJson(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (!obj.category || !obj.priority) return null;
    return {
      category: obj.category as SacAiClassification['category'],
      subcategory:
        typeof obj.subcategory === 'string' ? obj.subcategory : undefined,
      priority: obj.priority as SacAiClassification['priority'],
      sentiment: (obj.sentiment ?? 'neutral') as SacAiClassification['sentiment'],
      reputation_risk:
        (obj.reputation_risk ?? 'none') as SacAiClassification['reputation_risk'],
      risk_score: typeof obj.risk_score === 'number' ? obj.risk_score : 0,
      summary: typeof obj.summary === 'string' ? obj.summary : '',
      resolution_suggestion:
        typeof obj.resolution_suggestion === 'string'
          ? obj.resolution_suggestion
          : '',
      suggested_response:
        typeof obj.suggested_response === 'string' ? obj.suggested_response : '',
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.5,
    };
  }

  /** Tenta parse JSON robusto: aceita texto cru, com markdown fence, ou JSON puro. */
  private parseJson(raw: string): unknown {
    if (!raw) return null;
    const trimmed = raw.trim();
    // Remove ```json ... ``` se houver
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
    const candidate = fenced ? fenced[1] : trimmed;
    try {
      return JSON.parse(candidate);
    } catch {
      // Tenta achar primeiro { ... } no texto
      const m = /\{[\s\S]*\}/.exec(candidate);
      if (m) {
        try {
          return JSON.parse(m[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  private countBy(
    rows: Array<Record<string, unknown>>,
    key: string,
  ): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows) {
      const k = String(r[key] ?? 'unknown');
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }

  private avg(
    rows: Array<Record<string, unknown>>,
    key: string,
  ): number {
    const vals = rows
      .map((r) => r[key])
      .filter((v): v is number => typeof v === 'number');
    if (vals.length === 0) return 0;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }
}
