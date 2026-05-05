import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import type { OrgMemberRole } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../common/channels/channel-dispatcher.service';
import {
  CreateAlertManagerDto,
  UpdateAlertManagerDto,
} from './alerts.dto';

export type AlertManagerStatus = 'pending_verification' | 'active' | 'suspended';

export interface AlertManagerPublic {
  id: string;
  name: string;
  /** Phone só os 4 últimos dígitos visíveis ("...9999"), proteção de PII na UI. */
  phone_masked: string;
  department: string | null;
  channel_id: string | null;
  preferences: Record<string, unknown>;
  status: AlertManagerStatus;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AlertManagerInternal {
  id: string;
  org_id: string;
  name: string;
  phone: string;
  department: string | null;
  channel_id: string | null;
  preferences: Record<string, unknown>;
  verification_code: string | null;
  verification_expires_at: string | null;
  verified_at: string | null;
  status: AlertManagerStatus;
  created_at: string;
  updated_at: string;
}

const CODE_TTL_MIN = 10;
const RESEND_THROTTLE_MIN = 1;

/**
 * AlertManagersService — CRUD + verificação de phone via WhatsApp.
 *
 * Fluxo de verificação:
 *   1. POST /alert-managers cria com status='pending_verification'
 *   2. POST /:id/verify-phone — gera código 6 dígitos, envia via WhatsApp
 *      pro phone, salva code+expires_at
 *   3. POST /:id/confirm-phone — valida code → status='active', verified_at
 *
 * Multi-tenant: TODA query inclui org_id. UNIQUE (org_id, phone).
 *
 * Permissão: owner/admin podem criar/editar/deletar; qualquer membro
 * lista (pra UI mostrar pra todos).
 */
@Injectable()
export class AlertManagersService {
  private readonly logger = new Logger(AlertManagersService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: ChannelDispatcherService,
  ) {}

  // ────────────────────────────────────────────
  // CRUD
  // ────────────────────────────────────────────

  async list(orgId: string): Promise<AlertManagerPublic[]> {
    const { data, error } = await this.supabase.adminClient
      .from('alert_managers')
      .select(
        'id, org_id, name, phone, department, channel_id, preferences, status, verified_at, created_at, updated_at',
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (error) {
      this.logger.error(`list managers falhou: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return ((data ?? []) as AlertManagerInternal[]).map(toPublic);
  }

  async create(
    orgId: string,
    actorRole: OrgMemberRole,
    dto: CreateAlertManagerDto,
  ): Promise<AlertManagerPublic> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException(
        'Apenas owner/admin podem cadastrar gestores de alerta.',
      );
    }
    const phone = normalizePhone(dto.phone);

    const { data, error } = await this.supabase.adminClient
      .from('alert_managers')
      .insert({
        org_id: orgId,
        name: dto.name.trim(),
        phone,
        department: dto.department?.trim() ?? null,
        channel_id: dto.channel_id ?? null,
        preferences: dto.preferences ?? {},
        status: 'pending_verification',
      })
      .select(
        'id, org_id, name, phone, department, channel_id, preferences, status, verified_at, created_at, updated_at',
      )
      .single();

    if (error || !data) {
      if (error?.message.toLowerCase().includes('duplicate')) {
        throw new BadRequestException(
          `Esse telefone já está cadastrado nesta organização.`,
        );
      }
      this.logger.error(`create manager falhou: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Falha ao criar manager');
    }
    return toPublic(data as AlertManagerInternal);
  }

  async update(
    orgId: string,
    actorRole: OrgMemberRole,
    managerId: string,
    dto: UpdateAlertManagerDto,
  ): Promise<AlertManagerPublic> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException(
        'Apenas owner/admin podem editar gestores de alerta.',
      );
    }
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.department !== undefined) patch.department = dto.department.trim() || null;
    if (dto.channel_id !== undefined) patch.channel_id = dto.channel_id;
    if (dto.preferences !== undefined) patch.preferences = dto.preferences;
    if (dto.status !== undefined) patch.status = dto.status;

    if (Object.keys(patch).length === 0) {
      return this.getByIdOrThrow(orgId, managerId);
    }

    const { data, error } = await this.supabase.adminClient
      .from('alert_managers')
      .update(patch)
      .eq('id', managerId)
      .eq('org_id', orgId)
      .select(
        'id, org_id, name, phone, department, channel_id, preferences, status, verified_at, created_at, updated_at',
      )
      .single();

    if (error || !data) {
      this.logger.error(`update manager falhou: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Falha ao atualizar');
    }
    return toPublic(data as AlertManagerInternal);
  }

  async remove(
    orgId: string,
    actorRole: OrgMemberRole,
    managerId: string,
  ): Promise<void> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException(
        'Apenas owner/admin podem remover gestores de alerta.',
      );
    }
    const { error } = await this.supabase.adminClient
      .from('alert_managers')
      .delete()
      .eq('id', managerId)
      .eq('org_id', orgId);
    if (error) {
      this.logger.error(`delete manager falhou: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  // ────────────────────────────────────────────
  // Verification flow
  // ────────────────────────────────────────────

  /**
   * Gera código de 6 dígitos, envia via WhatsApp pro phone do manager
   * (cold outbound — funciona graças ao resolveJid no worker), salva
   * code+expires na row. Throttled a 1 send / minuto.
   */
  async requestVerification(
    orgId: string,
    actorRole: OrgMemberRole,
    managerId: string,
  ): Promise<{ ok: true; expires_in_minutes: number }> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException(
        'Apenas owner/admin podem disparar verificação.',
      );
    }
    const manager = await this.getInternalOrThrow(orgId, managerId);

    // Throttle: se já tem code dentro da janela RESEND_THROTTLE, recusa
    if (
      manager.verification_expires_at &&
      new Date(manager.verification_expires_at).getTime() - Date.now() >
        (CODE_TTL_MIN - RESEND_THROTTLE_MIN) * 60_000
    ) {
      throw new BadRequestException(
        `Aguarde ${RESEND_THROTTLE_MIN} minuto antes de pedir um novo código.`,
      );
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60_000);

    // Resolve canal: usa o do manager se setado, senão default da org
    const channelId =
      manager.channel_id ?? (await this.resolveDefaultWhatsappChannel(orgId));
    if (!channelId) {
      throw new BadRequestException(
        'Nenhum canal WhatsApp ativo encontrado. Configure em /configuracoes > Canais antes.',
      );
    }

    // Persiste code ANTES de enviar — se envio falhar, código já está
    // salvo e user pode pedir reenvio sem race
    const { error: updErr } = await this.supabase.adminClient
      .from('alert_managers')
      .update({
        verification_code: code,
        verification_expires_at: expiresAt.toISOString(),
      })
      .eq('id', managerId)
      .eq('org_id', orgId);
    if (updErr) {
      throw new InternalServerErrorException(updErr.message);
    }

    const body = formatVerificationMessage(manager.name, code);
    try {
      const channel = await this.dispatcher.getChannel(orgId, channelId);
      const provider = this.dispatcher.getProvider(channel.channel_type);
      await provider.sendMessage({
        channel,
        to: manager.phone,
        content_type: 'text',
        content: { body },
      });
    } catch (err) {
      this.logger.error(
        `requestVerification send falhou manager=${managerId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException(
        'Falha ao enviar código via WhatsApp. Verifique se o número tem WhatsApp ativo.',
      );
    }

    return { ok: true, expires_in_minutes: CODE_TTL_MIN };
  }

  async confirmPhone(
    orgId: string,
    managerId: string,
    code: string,
  ): Promise<AlertManagerPublic> {
    const manager = await this.getInternalOrThrow(orgId, managerId);

    if (!manager.verification_code || !manager.verification_expires_at) {
      throw new BadRequestException(
        'Nenhum código pendente. Peça um novo código primeiro.',
      );
    }
    if (new Date(manager.verification_expires_at).getTime() < Date.now()) {
      throw new BadRequestException('Código expirado. Peça um novo.');
    }
    if (manager.verification_code !== code) {
      throw new BadRequestException('Código inválido.');
    }

    const { data, error } = await this.supabase.adminClient
      .from('alert_managers')
      .update({
        status: 'active',
        verified_at: new Date().toISOString(),
        verification_code: null,
        verification_expires_at: null,
      })
      .eq('id', managerId)
      .eq('org_id', orgId)
      .select(
        'id, org_id, name, phone, department, channel_id, preferences, status, verified_at, created_at, updated_at',
      )
      .single();

    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao confirmar');
    }
    return toPublic(data as AlertManagerInternal);
  }

  // ────────────────────────────────────────────
  // Internals (consumidos pelo AlertEngine)
  // ────────────────────────────────────────────

  /** Lista managers active+verified — engine usa pra filtrar destinatários. */
  async listActive(orgId: string): Promise<AlertManagerInternal[]> {
    const { data } = await this.supabase.adminClient
      .from('alert_managers')
      .select('*')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .not('verified_at', 'is', null);
    return (data ?? []) as AlertManagerInternal[];
  }

  async listByIds(orgId: string, ids: string[]): Promise<AlertManagerInternal[]> {
    if (ids.length === 0) return [];
    const { data } = await this.supabase.adminClient
      .from('alert_managers')
      .select('*')
      .eq('org_id', orgId)
      .in('id', ids);
    return (data ?? []) as AlertManagerInternal[];
  }

  // ────────────────────────────────────────────
  // Privates
  // ────────────────────────────────────────────

  private async getByIdOrThrow(
    orgId: string,
    managerId: string,
  ): Promise<AlertManagerPublic> {
    return toPublic(await this.getInternalOrThrow(orgId, managerId));
  }

  private async getInternalOrThrow(
    orgId: string,
    managerId: string,
  ): Promise<AlertManagerInternal> {
    const { data, error } = await this.supabase.adminClient
      .from('alert_managers')
      .select('*')
      .eq('id', managerId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Manager não encontrado.');
    return data as AlertManagerInternal;
  }

  private async resolveDefaultWhatsappChannel(orgId: string): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('channels')
      .select('id, channel_type, status, created_at')
      .eq('org_id', orgId)
      .in('channel_type', ['whatsapp', 'whatsapp_free'])
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1);
    const row = (data ?? [])[0] as { id: string } | undefined;
    return row?.id ?? null;
  }
}

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Não força DDI 55 — manager pode estar fora do BR. resolveJid no worker
  // chama onWhatsApp que aceita qualquer formato internacional.
  return digits;
}

function generateCode(): string {
  // 6 dígitos zero-padded. Crypto.randomInt evita previsibilidade do Math.random.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function formatVerificationMessage(name: string, code: string): string {
  const firstName = name.trim().split(/\s+/)[0] ?? name;
  return `Olá ${firstName}! 👋

Aqui é o e-Click Active. Seu código de verificação para receber alertas é:

*${code}*

O código expira em ${CODE_TTL_MIN} minutos. Se você não solicitou, pode ignorar.`;
}

function toPublic(internal: AlertManagerInternal): AlertManagerPublic {
  const last4 = internal.phone.slice(-4);
  return {
    id: internal.id,
    name: internal.name,
    phone_masked: `...${last4}`,
    department: internal.department,
    channel_id: internal.channel_id,
    preferences: internal.preferences,
    status: internal.status,
    verified_at: internal.verified_at,
    created_at: internal.created_at,
    updated_at: internal.updated_at,
  };
}
