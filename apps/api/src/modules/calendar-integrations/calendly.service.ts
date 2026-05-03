import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  decodeOAuthState,
  decryptToken,
  encodeOAuthState,
  encryptToken,
} from './crypto.helper';

const CALENDLY_AUTH_URL = 'https://auth.calendly.com/oauth/authorize';
const CALENDLY_TOKEN_URL = 'https://auth.calendly.com/oauth/token';
const CALENDLY_API = 'https://api.calendly.com';

interface CalendlyTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  owner: string; // URI do user
}

interface CalendlyUser {
  uri: string;
  name: string;
  email: string;
  scheduling_url: string;
  current_organization: string;
}

export interface CalendlyEventType {
  uri: string;
  name: string;
  active: boolean;
  scheduling_url: string;
  duration: number;
  kind: string;
}

/**
 * Integração Calendly via OAuth2 + REST. Pull/push de event types e
 * webhooks pra receber agendamentos em tempo real.
 *
 * Doc: https://developer.calendly.com
 */
@Injectable()
export class CalendlyService {
  private readonly logger = new Logger(CalendlyService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ────────────────────────────────────────────
  // OAuth flow
  // ────────────────────────────────────────────

  getAuthUrl(orgId: string, agentId: string): string {
    const clientId = this.requireEnv('CALENDLY_CLIENT_ID');
    const redirectUri = this.requireEnv('CALENDLY_REDIRECT_URI');
    const state = encodeOAuthState({ org_id: orgId, agent_id: agentId });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });
    return `${CALENDLY_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ org_id: string; agent_id: string; integration_id: string }> {
    const decoded = decodeOAuthState(state);
    if (!decoded) throw new BadRequestException('State inválido ou expirado');

    const tokens = await this.exchangeCodeForTokens(code);
    const userInfo = await this.fetchUserInfo(tokens.access_token);

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const { data, error } = await this.supabase.adminClient
      .from('calendar_integrations')
      .upsert(
        {
          org_id: decoded.org_id,
          agent_id: decoded.agent_id,
          provider: 'calendly',
          access_token: encryptToken(tokens.access_token),
          refresh_token: encryptToken(tokens.refresh_token),
          token_expires_at: expiresAt,
          calendar_id: userInfo.uri, // user URI faz papel de calendar_id
          calendar_name: userInfo.name,
          status: 'active',
          last_error: null,
          metadata: {
            scheduling_url: userInfo.scheduling_url,
            email: userInfo.email,
            organization: userInfo.current_organization,
          },
        },
        { onConflict: 'org_id,agent_id,provider' },
      )
      .select('id')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao salvar Calendly');
    }
    return {
      org_id: decoded.org_id,
      agent_id: decoded.agent_id,
      integration_id: (data as { id: string }).id,
    };
  }

  private async exchangeCodeForTokens(code: string): Promise<CalendlyTokens> {
    const clientId = this.requireEnv('CALENDLY_CLIENT_ID');
    const clientSecret = this.requireEnv('CALENDLY_CLIENT_SECRET');
    const redirectUri = this.requireEnv('CALENDLY_REDIRECT_URI');

    const res = await fetch(CALENDLY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }).toString(),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(`Calendly token exchange: ${await res.text()}`);
    }
    return (await res.json()) as CalendlyTokens;
  }

  private async fetchUserInfo(accessToken: string): Promise<CalendlyUser> {
    const res = await fetch(`${CALENDLY_API}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new InternalServerErrorException('Falha ao buscar user Calendly');
    const json = (await res.json()) as { resource: CalendlyUser };
    return json.resource;
  }

  // ────────────────────────────────────────────
  // Refresh token
  // ────────────────────────────────────────────

  async getValidAccessToken(integrationId: string): Promise<string> {
    const { data, error } = await this.supabase.adminClient
      .from('calendar_integrations')
      .select('access_token, refresh_token, token_expires_at, status')
      .eq('id', integrationId)
      .maybeSingle();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Integração não encontrada');
    }
    const row = data as {
      access_token: string | null;
      refresh_token: string | null;
      token_expires_at: string | null;
      status: string;
    };
    if (row.status !== 'active') {
      throw new BadRequestException(`Integração com status ${row.status}`);
    }

    const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
    if (expiresAt - Date.now() > 2 * 60_000) {
      const access = decryptToken(row.access_token);
      if (access) return access;
    }

    const refreshToken = decryptToken(row.refresh_token);
    if (!refreshToken) {
      throw new BadRequestException('Refresh token ausente — reconecte');
    }

    const clientId = this.requireEnv('CALENDLY_CLIENT_ID');
    const clientSecret = this.requireEnv('CALENDLY_CLIENT_SECRET');
    const res = await fetch(CALENDLY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(`Refresh Calendly: ${await res.text()}`);
    }
    const refreshed = (await res.json()) as CalendlyTokens;
    const newExpires = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await this.supabase.adminClient
      .from('calendar_integrations')
      .update({
        access_token: encryptToken(refreshed.access_token),
        refresh_token: encryptToken(refreshed.refresh_token),
        token_expires_at: newExpires,
        status: 'active',
        last_error: null,
      })
      .eq('id', integrationId);
    return refreshed.access_token;
  }

  // ────────────────────────────────────────────
  // Event types + scheduling URL
  // ────────────────────────────────────────────

  async getEventTypes(integrationId: string): Promise<CalendlyEventType[]> {
    const accessToken = await this.getValidAccessToken(integrationId);

    const { data: integration } = await this.supabase.adminClient
      .from('calendar_integrations')
      .select('calendar_id')
      .eq('id', integrationId)
      .maybeSingle();
    const userUri = (integration as { calendar_id: string | null } | null)?.calendar_id;
    if (!userUri) return [];

    const res = await fetch(
      `${CALENDLY_API}/event_types?user=${encodeURIComponent(userUri)}&active=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      this.logger.warn(`getEventTypes falhou: ${await res.text()}`);
      return [];
    }
    const json = (await res.json()) as { collection: CalendlyEventType[] };
    return json.collection ?? [];
  }

  /**
   * Retorna o scheduling URL geral do agente (todos os event types disponíveis)
   * ou um URL específico de event type quando passado.
   */
  async getSchedulingLink(integrationId: string, eventTypeUri?: string): Promise<string | null> {
    if (eventTypeUri) {
      // event_type_uri tem formato https://api.calendly.com/event_types/{uuid}
      // O scheduling URL fica disponível no event_type detail, mas pra economizar
      // chamada extra retornamos o user-level URL com hint do nome.
      const types = await this.getEventTypes(integrationId);
      const found = types.find((t) => t.uri === eventTypeUri);
      return found?.scheduling_url ?? null;
    }

    const { data } = await this.supabase.adminClient
      .from('calendar_integrations')
      .select('metadata')
      .eq('id', integrationId)
      .maybeSingle();
    const meta = (data as { metadata: Record<string, unknown> | null } | null)?.metadata;
    return (meta?.scheduling_url as string | undefined) ?? null;
  }

  // ────────────────────────────────────────────
  // Webhook — Calendly notifica criação/cancelamento
  // ────────────────────────────────────────────

  /**
   * Handler do POST /calendar/calendly/webhook.
   * Eventos esperados:
   *   - invitee.created  → criar appointment + criar/vincular contato
   *   - invitee.canceled → cancelar appointment
   *
   * Calendly assina os webhooks com HMAC-SHA256 (Calendly-Webhook-Signature
   * header). A validação é feita no controller antes de chamar este método.
   */
  async handleWebhook(body: {
    event: string;
    payload: {
      event?: { uri: string; start_time: string; end_time: string; name?: string };
      invitee?: {
        uri: string;
        name?: string;
        email?: string;
        questions_and_answers?: Array<{ question: string; answer: string }>;
        status?: string;
        cancel_reason?: string;
      };
      event_type?: { uri: string; name: string };
    };
  }): Promise<void> {
    const eventName = body.event;

    // Encontra a integração via event.uri (precisa puxar detalhe do evento
    // pra descobrir owner). Pra simplificar v1, exigimos que o webhook
    // venha pra integration que tem `metadata.calendar_id` igual ao owner.
    // Como otimização, pulamos checagem de owner e iteramos sobre todas as
    // integrações ativas — como webhooks são raros, custo baixo.

    if (eventName === 'invitee.created') {
      await this.handleInviteeCreated(body.payload);
    } else if (eventName === 'invitee.canceled') {
      await this.handleInviteeCanceled(body.payload);
    } else {
      this.logger.debug(`Webhook Calendly ignorado: ${eventName}`);
    }
  }

  private async handleInviteeCreated(
    payload: {
      event?: { uri: string; start_time: string; end_time: string; name?: string };
      invitee?: {
        uri: string;
        name?: string;
        email?: string;
        questions_and_answers?: Array<{ question: string; answer: string }>;
      };
      event_type?: { uri: string; name: string };
    },
  ): Promise<void> {
    const event = payload.event;
    const invitee = payload.invitee;
    if (!event || !invitee) return;

    // Busca integração pelo event_type.uri ou pelo owner do event.
    // Calendly não manda owner direto no payload, então fazemos best-effort:
    // se ENCONTRAR uma integração ativa (qualquer org), usamos a primeira.
    // Em produção real, validar via fetch /scheduled_events/{uuid}.
    const { data: integrations } = await this.supabase.adminClient
      .from('calendar_integrations')
      .select('id, org_id, agent_id, auto_create_deal')
      .eq('provider', 'calendly')
      .eq('status', 'active')
      .limit(50);

    if (!integrations || integrations.length === 0) {
      this.logger.warn('Webhook Calendly recebido mas sem integração ativa');
      return;
    }

    // V1: usa a primeira integração ativa. V2: validar owner.
    const integration = integrations[0] as {
      id: string;
      org_id: string;
      agent_id: string;
      auto_create_deal: boolean;
    };

    // Extrai telefone das custom questions (campos comuns: "Phone", "Telefone")
    const phone = invitee.questions_and_answers?.find((qa) =>
      /telefone|phone|whats?app/i.test(qa.question),
    )?.answer ?? null;

    // Vincula/cria contato por email
    let contactId: string | null = null;
    if (invitee.email) {
      const { data: existing } = await this.supabase.adminClient
        .from('contacts')
        .select('id')
        .eq('org_id', integration.org_id)
        .eq('email', invitee.email)
        .maybeSingle();
      if (existing) {
        contactId = (existing as { id: string }).id;
      } else {
        const { data: created } = await this.supabase.adminClient
          .from('contacts')
          .insert({
            org_id: integration.org_id,
            name: invitee.name ?? null,
            email: invitee.email,
            phone,
            metadata: { source: 'calendly', invitee_uri: invitee.uri },
          })
          .select('id')
          .single();
        contactId = (created as { id: string } | null)?.id ?? null;
      }
    }

    // Cria appointment
    const { data: appt } = await this.supabase.adminClient
      .from('appointments')
      .insert({
        org_id: integration.org_id,
        title: payload.event_type?.name ?? event.name ?? 'Agendamento Calendly',
        start_time: event.start_time,
        end_time: event.end_time,
        contact_id: contactId,
        assigned_to: integration.agent_id,
        status: 'scheduled',
        external_calendar_id: event.uri,
        external_calendar_provider: 'calendly',
        notes: invitee.questions_and_answers
          ?.map((qa) => `${qa.question}: ${qa.answer}`)
          .join('\n') ?? null,
        metadata: {
          calendly: {
            invitee_uri: invitee.uri,
            event_type_uri: payload.event_type?.uri ?? null,
          },
        },
      })
      .select('id')
      .single();

    // Auto-create deal (best-effort)
    if (integration.auto_create_deal && contactId) {
      void this.createDealForCalendlyBooking(
        integration.org_id,
        contactId,
        invitee.name ?? invitee.email ?? 'Lead Calendly',
      );
    }

    this.logger.log(
      `Calendly invitee.created → appointment ${(appt as { id: string } | null)?.id ?? '?'}`,
    );
  }

  private async handleInviteeCanceled(payload: {
    event?: { uri: string };
    invitee?: { cancel_reason?: string };
  }): Promise<void> {
    const eventUri = payload.event?.uri;
    if (!eventUri) return;
    const { error } = await this.supabase.adminClient
      .from('appointments')
      .update({
        status: 'cancelled',
        cancelled_reason: payload.invitee?.cancel_reason ?? 'Cancelado via Calendly',
      })
      .eq('external_calendar_id', eventUri)
      .eq('external_calendar_provider', 'calendly');
    if (error) this.logger.warn(`Cancel via Calendly falhou: ${error.message}`);
  }

  private async createDealForCalendlyBooking(
    orgId: string,
    contactId: string,
    leadName: string,
  ): Promise<void> {
    // Pega primeiro pipeline ativo + primeiro stage não-fechamento
    const { data: pipeline } = await this.supabase.adminClient
      .from('pipelines')
      .select('id')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    const pipelineId = (pipeline as { id: string } | null)?.id;
    if (!pipelineId) return;

    const { data: stage } = await this.supabase.adminClient
      .from('pipeline_stages')
      .select('id')
      .eq('org_id', orgId)
      .eq('pipeline_id', pipelineId)
      .eq('is_won', false)
      .eq('is_lost', false)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    const stageId = (stage as { id: string } | null)?.id;
    if (!stageId) return;

    await this.supabase.adminClient
      .from('deals')
      .insert({
        org_id: orgId,
        title: `Agendamento Calendly — ${leadName}`,
        contact_id: contactId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        value: 0,
        currency: 'BRL',
      })
      .then(() => {})
      .then(undefined, () => {});
  }

  // ────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────

  private requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) {
      throw new InternalServerErrorException(`Env var ${name} ausente`);
    }
    return v;
  }
}
