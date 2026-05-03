import { Injectable, Logger } from '@nestjs/common';
import type { WhatsAppCheckResult } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';

interface ChannelRow {
  id: string;
  channel_type: 'whatsapp' | 'whatsapp_free' | string;
  status: string;
  credentials: Record<string, unknown> | null;
}

/**
 * Serviço de validação WhatsApp.
 *
 * Tem dois caminhos:
 *  - **Baileys** (preferido): chama o worker via `INTERNAL_API_URL/internal/baileys/check-number`.
 *    Gratuito, mas requer canal `whatsapp_free` pareado e ativo.
 *  - **Z-API**: usa `phone-exists/{phone}` da Z-API. Consome créditos.
 *
 * Decisão de provider:
 *  - Se a org tem canal `whatsapp_free` ativo → usa Baileys.
 *  - Senão, se tem `whatsapp` (Z-API) ativo → usa Z-API.
 *  - Senão → grava `whatsapp_verified=null` e marca a fila como `error`
 *    com motivo `no_provider`.
 *
 * Rate limiting é feito a montante pelo worker da fila (não aqui).
 */
@Injectable()
export class WhatsappValidatorService {
  private readonly logger = new Logger(WhatsappValidatorService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ──────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────

  /**
   * Valida UM telefone agora (síncrono). Atualiza a row de contato com
   * o resultado e retorna o objeto consultor. Use isso pro botão "validar
   * agora" da UI ou pra batch-orchestrator chamar de N em N.
   */
  async validatePhone(
    orgId: string,
    contactId: string,
    phone: string,
  ): Promise<WhatsAppCheckResult | null> {
    const provider = await this.pickProvider(orgId);
    if (!provider) {
      this.logger.debug(`validatePhone: org ${orgId} sem provider — skip`);
      return null;
    }

    let result: WhatsAppCheckResult | null = null;
    try {
      if (provider === 'baileys') {
        result = await this.checkViaBaileys(orgId, phone);
      } else {
        result = await this.checkViaZapi(orgId, phone);
      }
    } catch (err) {
      this.logger.warn(
        `validatePhone provider=${provider} falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    if (result) {
      await this.persistResult(orgId, contactId, result);
    }
    return result;
  }

  /**
   * Enfileira um contato pra validação assíncrona. Não bloqueia o caller.
   * Usado pelo `ContactsService.create` (auto-validate) e pelo endpoint
   * de batch.
   */
  async enqueue(orgId: string, contactId: string, phone: string): Promise<void> {
    if (!phone) return;
    const provider = await this.pickProvider(orgId);
    if (!provider) {
      this.logger.debug(`enqueue: org ${orgId} sem provider — não enfileira`);
      return;
    }
    // Upsert por (org_id, contact_id) — re-validação substitui pendente
    const { error } = await this.supabase.adminClient
      .from('whatsapp_validation_queue')
      .upsert(
        {
          org_id: orgId,
          contact_id: contactId,
          phone,
          status: 'pending',
          provider,
          attempts: 0,
          processed_at: null,
          error_message: null,
        },
        { onConflict: 'org_id,contact_id' },
      );
    if (error) {
      this.logger.warn(`enqueue falhou: ${error.message}`);
    }
  }

  /**
   * Estatísticas pra dashboards: total, verificados, válidos, inválidos,
   * pendentes na fila.
   */
  async getStats(orgId: string): Promise<{
    total: number;
    verified_valid: number;
    verified_invalid: number;
    not_verified: number;
    pending: number;
  }> {
    const { count: total } = await this.supabase.adminClient
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId);

    const { count: validCount } = await this.supabase.adminClient
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('whatsapp_verified', true);

    const { count: invalidCount } = await this.supabase.adminClient
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('whatsapp_verified', false);

    const { count: pendingCount } = await this.supabase.adminClient
      .from('whatsapp_validation_queue')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'pending');

    const t = total ?? 0;
    const v = validCount ?? 0;
    const i = invalidCount ?? 0;
    return {
      total: t,
      verified_valid: v,
      verified_invalid: i,
      not_verified: Math.max(0, t - v - i),
      pending: pendingCount ?? 0,
    };
  }

  // ──────────────────────────────────────────────────────────
  // Provider checks
  // ──────────────────────────────────────────────────────────

  private async checkViaBaileys(
    orgId: string,
    phone: string,
  ): Promise<WhatsAppCheckResult | null> {
    const url = process.env.WORKER_INTERNAL_URL;
    const key = process.env.INTERNAL_API_KEY;
    if (!url || !key) {
      this.logger.warn(
        '[whatsapp-validator] WORKER_INTERNAL_URL ou INTERNAL_API_KEY ausente',
      );
      return null;
    }
    const res = await fetch(`${url}/internal/baileys/check-number`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': key,
      },
      body: JSON.stringify({ org_id: orgId, phone }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `[whatsapp-validator] baileys check-number ${res.status}: ${text.slice(0, 200)}`,
      );
      return null;
    }
    const data = (await res.json()) as {
      exists: boolean;
      jid?: string;
      profile_name?: string;
      profile_pic_url?: string;
    };
    return {
      exists: data.exists === true,
      ...(data.jid ? { jid: data.jid } : {}),
      ...(data.profile_name ? { profile_name: data.profile_name } : {}),
      ...(data.profile_pic_url ? { profile_pic_url: data.profile_pic_url } : {}),
      provider: 'baileys',
    };
  }

  private async checkViaZapi(
    orgId: string,
    phone: string,
  ): Promise<WhatsAppCheckResult | null> {
    const channel = await this.firstActiveChannel(orgId, 'whatsapp');
    if (!channel) return null;
    const creds = (channel.credentials ?? {}) as {
      instanceId?: string;
      token?: string;
    };
    if (!creds.instanceId || !creds.token) return null;

    const url = `https://api.z-api.io/instances/${creds.instanceId}/token/${creds.token}/phone-exists/${encodeURIComponent(phone.replace(/\D/g, ''))}`;
    const res = await fetch(url);
    if (!res.ok) {
      this.logger.warn(`[whatsapp-validator] zapi phone-exists ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { exists?: boolean; jid?: string };
    return {
      exists: data.exists === true,
      ...(data.jid ? { jid: data.jid } : {}),
      provider: 'zapi',
    };
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  /**
   * Decide provider preferido pra essa org. Baileys é gratuito → preferido
   * quando há sessão pareada. Caso contrário, Z-API.
   */
  private async pickProvider(orgId: string): Promise<'baileys' | 'zapi' | null> {
    const baileys = await this.firstActiveChannel(orgId, 'whatsapp_free');
    if (baileys) return 'baileys';
    const zapi = await this.firstActiveChannel(orgId, 'whatsapp');
    if (zapi) return 'zapi';
    return null;
  }

  private async firstActiveChannel(
    orgId: string,
    channelType: 'whatsapp' | 'whatsapp_free',
  ): Promise<ChannelRow | null> {
    const { data } = await this.supabase.adminClient
      .from('channels')
      .select('id, channel_type, status, credentials')
      .eq('org_id', orgId)
      .eq('channel_type', channelType)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    return (data as ChannelRow | null) ?? null;
  }

  private async persistResult(
    orgId: string,
    contactId: string,
    result: WhatsAppCheckResult,
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      whatsapp_verified: result.exists,
      whatsapp_verified_at: new Date().toISOString(),
    };
    if (result.exists) {
      if (result.jid) patch.whatsapp_jid = result.jid;
      if (result.profile_name) patch.whatsapp_profile_name = result.profile_name;
      if (result.profile_pic_url) patch.whatsapp_profile_pic_url = result.profile_pic_url;
    } else {
      // Limpa campos antigos se passou de "valid" pra "invalid"
      patch.whatsapp_jid = null;
      patch.whatsapp_profile_name = null;
      patch.whatsapp_profile_pic_url = null;
    }
    const { error } = await this.supabase.adminClient
      .from('contacts')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', contactId);
    if (error) {
      this.logger.warn(`persistResult falhou: ${error.message}`);
    }
  }
}
