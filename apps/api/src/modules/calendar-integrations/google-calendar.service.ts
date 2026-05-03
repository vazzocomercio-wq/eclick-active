import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { Appointment } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  decodeOAuthState,
  decryptToken,
  encodeOAuthState,
  encryptToken,
} from './crypto.helper';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
].join(' ');

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink?: string;
  updated?: string;
}

interface FreeBusyResponse {
  calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
}

/**
 * Serviço de OAuth2 + REST Calendar v3 do Google. Usa fetch nativo
 * (Node 18+) ao invés de googleapis pra manter o bundle leve.
 *
 * Endpoints usados:
 *   - oauth2/v2/auth      → autorização
 *   - oauth2/token        → exchange code → tokens
 *   - calendar/v3/users/me/calendarList    → lista calendários do usuário
 *   - calendar/v3/calendars/{id}/events    → CRUD eventos
 *   - calendar/v3/freeBusy                 → query disponibilidade
 *   - calendar/v3/events/watch             → push notifications (TODO)
 */
@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ────────────────────────────────────────────
  // OAuth flow
  // ────────────────────────────────────────────

  getAuthUrl(orgId: string, agentId: string): string {
    const clientId = this.requireEnv('GOOGLE_CLIENT_ID');
    const redirectUri = this.requireEnv('GOOGLE_REDIRECT_URI');
    const state = encodeOAuthState({ org_id: orgId, agent_id: agentId });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, state: string): Promise<{ org_id: string; agent_id: string; integration_id: string }> {
    const decoded = decodeOAuthState(state);
    if (!decoded) throw new BadRequestException('State inválido ou expirado');

    const tokens = await this.exchangeCodeForTokens(code);
    const calendarInfo = await this.fetchPrimaryCalendar(tokens.access_token);

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const { data, error } = await this.supabase.adminClient
      .from('calendar_integrations')
      .upsert(
        {
          org_id: decoded.org_id,
          agent_id: decoded.agent_id,
          provider: 'google',
          access_token: encryptToken(tokens.access_token),
          refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
          token_expires_at: expiresAt,
          calendar_id: calendarInfo.id,
          calendar_name: calendarInfo.summary,
          status: 'active',
          last_error: null,
        },
        { onConflict: 'org_id,agent_id,provider' },
      )
      .select('id')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao salvar integração');
    }
    return {
      org_id: decoded.org_id,
      agent_id: decoded.agent_id,
      integration_id: (data as { id: string }).id,
    };
  }

  private async exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
    const clientId = this.requireEnv('GOOGLE_CLIENT_ID');
    const clientSecret = this.requireEnv('GOOGLE_CLIENT_SECRET');
    const redirectUri = this.requireEnv('GOOGLE_REDIRECT_URI');

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new InternalServerErrorException(`Google token exchange falhou: ${errText}`);
    }
    return (await res.json()) as GoogleTokens;
  }

  private async fetchPrimaryCalendar(accessToken: string): Promise<{ id: string; summary: string }> {
    const res = await fetch(`${GOOGLE_API}/users/me/calendarList?minAccessRole=owner`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new InternalServerErrorException('Falha ao listar calendários');
    const json = (await res.json()) as { items?: Array<{ id: string; summary: string; primary?: boolean }> };
    const primary = json.items?.find((c) => c.primary);
    if (!primary) {
      const first = json.items?.[0];
      if (!first) throw new InternalServerErrorException('Nenhum calendário acessível');
      return { id: first.id, summary: first.summary };
    }
    return { id: primary.id, summary: primary.summary };
  }

  // ────────────────────────────────────────────
  // Token refresh
  // ────────────────────────────────────────────

  /** Retorna access_token válido — refresh automático se expirado/perto. */
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
    // Se faltam <2min pra expirar, faz refresh
    if (expiresAt - Date.now() > 2 * 60_000) {
      const access = decryptToken(row.access_token);
      if (access) return access;
    }

    // Refresh
    const refreshToken = decryptToken(row.refresh_token);
    if (!refreshToken) {
      await this.markError(integrationId, 'Sem refresh_token — reconecte');
      throw new BadRequestException('Refresh token ausente — reconecte a integração');
    }

    const refreshed = await this.refreshAccessToken(refreshToken);
    const newExpires = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await this.supabase.adminClient
      .from('calendar_integrations')
      .update({
        access_token: encryptToken(refreshed.access_token),
        token_expires_at: newExpires,
        status: 'active',
        last_error: null,
      })
      .eq('id', integrationId);
    return refreshed.access_token;
  }

  private async refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
    const clientId = this.requireEnv('GOOGLE_CLIENT_ID');
    const clientSecret = this.requireEnv('GOOGLE_CLIENT_SECRET');
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(`Refresh token inválido: ${await res.text()}`);
    }
    return (await res.json()) as GoogleTokens;
  }

  // ────────────────────────────────────────────
  // CRUD de eventos
  // ────────────────────────────────────────────

  async createEvent(
    integrationId: string,
    calendarId: string,
    appointment: Pick<
      Appointment,
      'title' | 'description' | 'start_time' | 'end_time' | 'location_details'
    > & { contact_email?: string | null },
  ): Promise<{ event_id: string; html_link: string | null }> {
    const accessToken = await this.getValidAccessToken(integrationId);
    const body = {
      summary: appointment.title,
      description: appointment.description ?? undefined,
      location: appointment.location_details ?? undefined,
      start: { dateTime: appointment.start_time },
      end: { dateTime: appointment.end_time },
      attendees: appointment.contact_email
        ? [{ email: appointment.contact_email }]
        : undefined,
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 },
          { method: 'popup', minutes: 24 * 60 },
        ],
      },
    };

    const res = await fetch(
      `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const t = await res.text();
      throw new InternalServerErrorException(`Falha ao criar evento Google: ${t}`);
    }
    const json = (await res.json()) as GoogleEvent;
    return { event_id: json.id, html_link: json.htmlLink ?? null };
  }

  async updateEvent(
    integrationId: string,
    calendarId: string,
    eventId: string,
    patch: Partial<Pick<Appointment, 'title' | 'description' | 'start_time' | 'end_time'>>,
  ): Promise<void> {
    const accessToken = await this.getValidAccessToken(integrationId);
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.summary = patch.title;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.start_time) body.start = { dateTime: patch.start_time };
    if (patch.end_time) body.end = { dateTime: patch.end_time };

    const res = await fetch(
      `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new InternalServerErrorException(`Falha ao atualizar evento: ${await res.text()}`);
    }
  }

  async deleteEvent(integrationId: string, calendarId: string, eventId: string): Promise<void> {
    const accessToken = await this.getValidAccessToken(integrationId);
    const res = await fetch(
      `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    // 410 = já deletado, aceita
    if (!res.ok && res.status !== 410 && res.status !== 404) {
      throw new InternalServerErrorException(`Falha ao deletar evento: ${await res.text()}`);
    }
  }

  // ────────────────────────────────────────────
  // FreeBusy — usado em getAvailableSlots
  // ────────────────────────────────────────────

  /**
   * Retorna intervalos ocupados do calendário entre timeMin e timeMax.
   * Usado pra excluir slots que conflitam com agenda pessoal.
   */
  async getBusyRanges(
    integrationId: string,
    calendarId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<Array<{ start: string; end: string }>> {
    const accessToken = await this.getValidAccessToken(integrationId);
    const res = await fetch(`${GOOGLE_API}/freeBusy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: [{ id: calendarId }],
      }),
    });
    if (!res.ok) {
      this.logger.warn(`freeBusy falhou: ${await res.text()}`);
      return [];
    }
    const json = (await res.json()) as FreeBusyResponse;
    return json.calendars?.[calendarId]?.busy ?? [];
  }

  // ────────────────────────────────────────────
  // Pull sync — busca eventos novos do Google
  // ────────────────────────────────────────────

  /**
   * Pull events updated since `updatedMin` e retorna pra caller decidir
   * o que fazer (criar/atualizar/cancelar appointments).
   */
  async listEventsUpdatedSince(
    integrationId: string,
    calendarId: string,
    updatedMin: string,
    timeMax?: string,
  ): Promise<GoogleEvent[]> {
    const accessToken = await this.getValidAccessToken(integrationId);
    const params = new URLSearchParams({
      updatedMin,
      showDeleted: 'true',
      singleEvents: 'true',
      maxResults: '250',
    });
    if (timeMax) params.set('timeMax', timeMax);

    const res = await fetch(
      `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      this.logger.warn(`list events falhou: ${await res.text()}`);
      return [];
    }
    const json = (await res.json()) as { items?: GoogleEvent[] };
    return json.items ?? [];
  }

  // ────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────

  async markError(integrationId: string, message: string): Promise<void> {
    await this.supabase.adminClient
      .from('calendar_integrations')
      .update({ status: 'error', last_error: message.slice(0, 500) })
      .eq('id', integrationId);
  }

  private requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) {
      throw new InternalServerErrorException(`Env var ${name} ausente — configure no .env`);
    }
    return v;
  }
}
