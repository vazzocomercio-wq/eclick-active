import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CalendarIntegration,
  CalendarIntegrationPublic,
  CalendarProvider,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { GoogleCalendarService } from './google-calendar.service';

/**
 * CRUD genérico de integrações + dispatcher de sync (chama o service
 * específico do provider). Mantém access_token/refresh_token NUNCA
 * expostos no payload retornado.
 */
@Injectable()
export class CalendarIntegrationsService {
  private readonly logger = new Logger(CalendarIntegrationsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly google: GoogleCalendarService,
  ) {}

  /** Strip access_token/refresh_token antes de devolver pra UI. */
  private toPublic(row: CalendarIntegration): CalendarIntegrationPublic {
    const { access_token: _at, refresh_token: _rt, ...rest } = row;
    return rest as CalendarIntegrationPublic;
  }

  async list(orgId: string, agentId?: string): Promise<CalendarIntegrationPublic[]> {
    let q = this.supabase.adminClient
      .from('calendar_integrations')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (agentId) q = q.eq('agent_id', agentId);

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(error.message);
    return ((data ?? []) as CalendarIntegration[]).map((r) => this.toPublic(r));
  }

  async findById(orgId: string, id: string): Promise<CalendarIntegrationPublic> {
    const { data, error } = await this.supabase.adminClient
      .from('calendar_integrations')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Integração ${id} não encontrada`);
    return this.toPublic(data as CalendarIntegration);
  }

  /**
   * Encontra integração ativa + sync_enabled de um agente em determinado
   * provider. Usado pelo appointments.service pra decidir se sincroniza.
   */
  async findActiveForAgent(
    orgId: string,
    agentId: string,
    provider: CalendarProvider,
  ): Promise<CalendarIntegration | null> {
    const { data } = await this.supabase.adminClient
      .from('calendar_integrations')
      .select('*')
      .eq('org_id', orgId)
      .eq('agent_id', agentId)
      .eq('provider', provider)
      .eq('status', 'active')
      .eq('sync_enabled', true)
      .maybeSingle();
    return (data as CalendarIntegration | null) ?? null;
  }

  async updateSettings(
    orgId: string,
    id: string,
    patch: {
      sync_enabled?: boolean;
      consider_personal_events?: boolean;
      bidirectional_sync?: boolean;
      auto_create_deal?: boolean;
    },
  ): Promise<CalendarIntegrationPublic> {
    await this.findById(orgId, id);
    const { data, error } = await this.supabase.adminClient
      .from('calendar_integrations')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao atualizar');
    }
    return this.toPublic(data as CalendarIntegration);
  }

  async disconnect(orgId: string, id: string): Promise<void> {
    await this.findById(orgId, id);
    const { error } = await this.supabase.adminClient
      .from('calendar_integrations')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);
  }

  /**
   * Sync manual sob demanda — chama syncFromGoogle / pull do Calendly.
   * V1: só Google implementado. Calendly recebe via webhook automaticamente.
   */
  async syncNow(orgId: string, id: string): Promise<{ ok: true; synced_at: string }> {
    const integration = await this.findById(orgId, id);
    if (integration.provider !== 'google') {
      throw new BadRequestException('Sync manual disponível apenas pra Google. Calendly é via webhook.');
    }
    if (!integration.calendar_id) {
      throw new BadRequestException('Integração sem calendar_id');
    }
    // Pull eventos atualizados desde último sync (ou últimos 30 dias)
    const updatedMin = integration.last_synced_at ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
    const events = await this.google.listEventsUpdatedSince(
      integration.id,
      integration.calendar_id,
      updatedMin,
    );
    this.logger.log(`Sync Google ${id}: ${events.length} eventos retornados`);
    // Nota: aplicar diff (criar/atualizar/cancelar appointments) é deixado
    // pra próxima iteração — exige reverse-mapping cuidadoso pra evitar
    // loops com eventos que o próprio CRM criou via syncToGoogle.

    const now = new Date().toISOString();
    await this.supabase.adminClient
      .from('calendar_integrations')
      .update({ last_synced_at: now })
      .eq('id', id);
    return { ok: true, synced_at: now };
  }
}
