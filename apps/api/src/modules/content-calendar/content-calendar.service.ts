import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { LlmService } from '../../common/llm/llm.service';
import type {
  ContentCalendarEvent,
  CreateEventInput,
  UpdateEventInput,
  ListEventsFilter,
  GeneratePlanInput,
  GeneratePlanResult,
  ContentChannel,
  ContentType,
  ContentStatus,
} from './content-calendar.types';

/**
 * CRUD do calendário de conteúdo + geração de plano com IA.
 *
 * Multi-tenant: TODA query filtra por org_id explicitamente — RLS é segunda
 * camada de defesa, mas confiar só nela é frágil em queries com adminClient.
 *
 * IA: usa LlmService.chat com feature='content_calendar_plan' (logado em
 * ai_interactions automaticamente).
 */
@Injectable()
export class ContentCalendarService {
  private readonly log = new Logger(ContentCalendarService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
  ) {}

  // ────────────────────────────────────────────
  // CRUD
  // ────────────────────────────────────────────

  async list(
    orgId: string,
    filter: ListEventsFilter,
  ): Promise<ContentCalendarEvent[]> {
    let q = this.supabase.adminClient
      .from('content_calendar')
      .select('*')
      .eq('org_id', orgId)
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true, nullsFirst: false });

    if (filter.from) q = q.gte('scheduled_date', filter.from);
    if (filter.to) q = q.lte('scheduled_date', filter.to);
    if (filter.channel) q = q.eq('channel', filter.channel);
    if (filter.status) q = q.eq('status', filter.status);

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as ContentCalendarEvent[];
  }

  async findById(orgId: string, id: string): Promise<ContentCalendarEvent> {
    const { data, error } = await this.supabase.adminClient
      .from('content_calendar')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Evento ${id} não encontrado`);
    return data as ContentCalendarEvent;
  }

  async create(
    orgId: string,
    userId: string,
    input: CreateEventInput,
  ): Promise<ContentCalendarEvent> {
    const { data, error } = await this.supabase.adminClient
      .from('content_calendar')
      .insert({
        org_id: orgId,
        user_id: userId,
        title: input.title,
        content_type: input.content_type,
        channel: input.channel,
        scheduled_date: input.scheduled_date,
        scheduled_time: input.scheduled_time ?? null,
        timezone: input.timezone ?? 'America/Bahia',
        product_id: input.product_id ?? null,
        social_content_id: input.social_content_id ?? null,
        ads_campaign_id: input.ads_campaign_id ?? null,
        status: input.status ?? 'planned',
        notes: input.notes ?? null,
        color: input.color ?? null,
        resource_snapshot: input.resource_snapshot ?? {},
      })
      .select('*')
      .single();
    if (error) {
      this.log.error(`create falhou: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return data as ContentCalendarEvent;
  }

  async update(
    orgId: string,
    id: string,
    patch: UpdateEventInput,
  ): Promise<ContentCalendarEvent> {
    // Confirma que existe + pertence à org
    await this.findById(orgId, id);

    const updates: Record<string, unknown> = {};
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.content_type !== undefined) updates.content_type = patch.content_type;
    if (patch.channel !== undefined) updates.channel = patch.channel;
    if (patch.scheduled_date !== undefined) updates.scheduled_date = patch.scheduled_date;
    if (patch.scheduled_time !== undefined) updates.scheduled_time = patch.scheduled_time;
    if (patch.timezone !== undefined) updates.timezone = patch.timezone;
    if (patch.product_id !== undefined) updates.product_id = patch.product_id;
    if (patch.social_content_id !== undefined) updates.social_content_id = patch.social_content_id;
    if (patch.ads_campaign_id !== undefined) updates.ads_campaign_id = patch.ads_campaign_id;
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.notes !== undefined) updates.notes = patch.notes;
    if (patch.color !== undefined) updates.color = patch.color;
    if (patch.resource_snapshot !== undefined) updates.resource_snapshot = patch.resource_snapshot;

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('Nenhum campo informado para update');
    }

    const { data, error } = await this.supabase.adminClient
      .from('content_calendar')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw new InternalServerErrorException(error.message);
    return data as ContentCalendarEvent;
  }

  async remove(orgId: string, id: string): Promise<void> {
    await this.findById(orgId, id);
    const { error } = await this.supabase.adminClient
      .from('content_calendar')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);
    if (error) throw new InternalServerErrorException(error.message);
  }

  // ────────────────────────────────────────────
  // IA: gerar plano semanal/mensal
  // ────────────────────────────────────────────

  async generatePlan(
    orgId: string,
    userId: string,
    input: GeneratePlanInput,
  ): Promise<GeneratePlanResult> {
    if (input.channels.length === 0) {
      throw new BadRequestException('Informe ao menos 1 canal');
    }

    const days = input.period === 'week' ? 7 : 30;
    const targetCount = input.period === 'week' ? 6 : 16; // 6/sem, 16/mês

    const productLines =
      (input.product_snapshots ?? [])
        .map(
          (p, i) =>
            `${i + 1}. ${p.name}${p.short_description ? ` — ${p.short_description}` : p.description ? ` — ${p.description.slice(0, 140)}` : ''} (id: ${p.id})`,
        )
        .join('\n') || '(sem produtos vinculados)';

    const systemPrompt = [
      'Você é um content strategist sênior. Dado um período, canais e produtos,',
      'monta um plano de conteúdo equilibrado, com mix de formatos (educativo,',
      'engajamento, ofertas, social proof). Distribui ao longo dos dias evitando',
      'cluster do mesmo canal no mesmo dia.',
      '',
      'Retorna APENAS JSON com o shape definido no schema. Nada antes ou depois.',
    ].join('\n');

    const userPrompt = [
      `Período: ${input.period} (${days} dias) começando em ${input.start_date}.`,
      `Canais permitidos: ${input.channels.join(', ')}.`,
      input.business_context
        ? `Contexto do negócio: ${input.business_context.slice(0, 500)}`
        : 'Negócio: pequeno comércio brasileiro genérico (assuma B2C).',
      '',
      'Produtos disponíveis pra referência (use product_id quando relevante):',
      productLines,
      '',
      `Gere ${targetCount}-${targetCount + 4} eventos. Distribua entre os canais informados.`,
      'Use horários sociais brasileiros (8h, 12h, 18h, 20h) — evite madrugada.',
      'Cada evento tem: title (curto, em PT-BR), content_type, channel, scheduled_date,',
      'scheduled_time (HH:MM), notes (1 frase com a ideia central), product_id (UUID se relevante).',
    ].join('\n');

    const schema = {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              content_type: { type: 'string' },
              channel: { type: 'string' },
              scheduled_date: { type: 'string' },
              scheduled_time: { type: 'string' },
              notes: { type: 'string' },
              product_id: { type: 'string' },
            },
            required: ['title', 'content_type', 'channel', 'scheduled_date'],
            additionalProperties: false,
          },
        },
      },
      required: ['events'],
      additionalProperties: false,
    } as const;

    const result = await this.llm.chat({
      orgId,
      feature: 'content_calendar_plan',
      system: systemPrompt,
      user: userPrompt,
      max_tokens: 2000,
      json_mode: true,
      temperature: 0.7,
      context: { user_id: userId },
      metadata: {
        period: input.period,
        start_date: input.start_date,
        channels: input.channels,
        product_count: (input.product_ids ?? []).length,
        schema_hint: schema,
      },
    });

    // Parse JSON output
    let parsed: { events?: Array<Record<string, unknown>> };
    try {
      parsed = JSON.parse(result.text) as typeof parsed;
    } catch {
      throw new InternalServerErrorException(
        'IA retornou formato inválido — tente novamente.',
      );
    }

    const productIdSet = new Set(input.product_ids ?? []);
    const allowedChannels = new Set<ContentChannel>(input.channels);

    const candidates = (parsed.events ?? [])
      .map((raw) => this.normalizeGeneratedEvent(raw, allowedChannels, productIdSet))
      .filter((e): e is CreateEventInput => e !== null);

    if (candidates.length === 0) {
      return {
        events: [],
        cost_usd: result.cost_usd,
        generated_count: 0,
      };
    }

    // INSERT em batch
    const { data, error } = await this.supabase.adminClient
      .from('content_calendar')
      .insert(
        candidates.map((c) => ({
          org_id: orgId,
          user_id: userId,
          title: c.title,
          content_type: c.content_type,
          channel: c.channel,
          scheduled_date: c.scheduled_date,
          scheduled_time: c.scheduled_time ?? null,
          timezone: c.timezone ?? 'America/Bahia',
          product_id: c.product_id ?? null,
          status: 'planned' as ContentStatus,
          notes: c.notes ?? null,
          color: c.color ?? null,
          resource_snapshot: {},
        })),
      )
      .select('*');

    if (error) {
      this.log.error(`generatePlan insert falhou: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    return {
      events: (data ?? []) as ContentCalendarEvent[],
      cost_usd: result.cost_usd,
      generated_count: candidates.length,
    };
  }

  /**
   * Sanitiza um evento gerado pela IA. Rejeita os que violam constraints
   * (channel inválido, content_type inválido, date malformada, etc).
   */
  private normalizeGeneratedEvent(
    raw: Record<string, unknown>,
    allowedChannels: Set<ContentChannel>,
    allowedProducts: Set<string>,
  ): CreateEventInput | null {
    const title = String(raw.title ?? '').trim();
    if (!title) return null;

    const channel = String(raw.channel ?? '') as ContentChannel;
    if (!allowedChannels.has(channel)) return null;

    const contentType = this.coerceContentType(raw.content_type, channel);
    if (!contentType) return null;

    const scheduledDate = String(raw.scheduled_date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return null;

    const rawTime = raw.scheduled_time != null ? String(raw.scheduled_time) : null;
    const scheduledTime = rawTime && /^\d{2}:\d{2}/.test(rawTime)
      ? rawTime.slice(0, 5) + ':00'
      : null;

    const productId =
      typeof raw.product_id === 'string' && allowedProducts.has(raw.product_id)
        ? raw.product_id
        : null;

    return {
      title: title.slice(0, 200),
      content_type: contentType,
      channel,
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      product_id: productId,
      notes:
        typeof raw.notes === 'string' ? raw.notes.slice(0, 500) : null,
    };
  }

  private coerceContentType(
    raw: unknown,
    channel: ContentChannel,
  ): ContentType | null {
    const valid: ContentType[] = [
      'social_post',
      'story',
      'reel',
      'tiktok',
      'email',
      'whatsapp_broadcast',
      'ad_launch',
    ];
    const t = String(raw ?? '').toLowerCase();
    if (valid.includes(t as ContentType)) return t as ContentType;

    // Inferência por canal quando IA mandou tipo inválido
    if (channel === 'tiktok') return 'tiktok';
    if (channel === 'email') return 'email';
    if (channel === 'whatsapp') return 'whatsapp_broadcast';
    if (channel === 'meta_ads' || channel === 'google_ads') return 'ad_launch';
    if (channel === 'instagram' || channel === 'facebook') return 'social_post';
    return null;
  }
}
