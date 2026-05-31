import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../../common/channels/channel-dispatcher.service';
import { AlertManagersService } from '../../alerts/alert-managers.service';
import { CortesDriveClient } from '../cortes-drive.client';

interface ManagerForAlert {
  id: string;
  name: string;
  phone: string;
  channel_id: string | null;
}

const TICK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const STARTUP_DELAY_MS = 4 * 60 * 1000; // 4min — depois dos outros workers
const DAY_MS = 24 * 60 * 60 * 1000;

const MASTER_TTL_DAYS = Number(process.env.CORTES_MASTER_TTL_DAYS ?? '3');
const WORKFILE_TTL_DAYS = Number(process.env.CORTES_WORKFILE_TTL_DAYS ?? '7');
const QUOTA_ALERT_PCT = Number(process.env.CORTES_QUOTA_ALERT_PCT ?? '80');

export interface JanitorResult {
  masters_deleted: number;
  workfiles_deleted: number;
  quota_percent: number | null;
  alerted: boolean;
}

/**
 * StorageJanitor — housekeeping do Shared Drive de cortes.
 *   1. Apaga o master N dias depois do job 'done' (marca master_deleted_at).
 *   2. Apaga arquivo de trabalho M dias depois do corte 'publicado'
 *      (marca work_file_deleted_at).
 *   3. Monitora cota: > QUOTA_ALERT_PCT% → alerta gestores no WhatsApp.
 *
 * Toda deleção é idempotente (só onde *_deleted_at IS NULL) e nunca toca
 * arquivo de job ativo (filtra status='done' / clip 'publicado').
 *
 * Padrão worker do Active: setInterval + startup delay. Kill: DISABLE_CORTES_JANITOR=true.
 */
@Injectable()
export class StorageJanitorWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(StorageJanitorWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;
  private readonly alertedToday = new Set<string>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly drive: CortesDriveClient,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly managers: AlertManagersService,
  ) {}

  onModuleInit(): void {
    if (process.env.DISABLE_CORTES_JANITOR === 'true') {
      this.log.warn('DISABLE_CORTES_JANITOR=true — janitor desligado');
      return;
    }
    this.startupTimeout = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
  }

  /** Roda pra todas as orgs com jobs. */
  private async tick(): Promise<void> {
    try {
      const { data } = await this.supabase.adminClient
        .from('content_jobs')
        .select('org_id')
        .limit(5000);
      const orgIds = Array.from(
        new Set((data ?? []).map((r: { org_id: string }) => r.org_id)),
      );
      for (const orgId of orgIds) {
        try {
          await this.runForOrg(orgId);
        } catch (err) {
          this.log.warn(`[janitor] org ${orgId} falhou: ${String(err)}`);
        }
      }
    } catch (err) {
      this.log.warn(`[janitor] tick falhou: ${String(err)}`);
    }
  }

  /** Executa o housekeeping pra UMA org (também usado pelo endpoint manual). */
  async runForOrg(orgId: string): Promise<JanitorResult> {
    const driveOn = await this.drive.isConfiguredForOrg(orgId);
    const masters_deleted = driveOn ? await this.cleanMasters(orgId) : 0;
    const workfiles_deleted = driveOn ? await this.cleanWorkFiles(orgId) : 0;

    let quota_percent: number | null = null;
    let alerted = false;
    if (driveOn) {
      try {
        const quota = await this.drive.getQuota(orgId);
        quota_percent = quota.percent;
        if (quota.percent >= QUOTA_ALERT_PCT) {
          alerted = await this.alertQuota(orgId, quota.percent);
        }
      } catch (err) {
        this.log.warn(`[janitor] cota org ${orgId}: ${String(err)}`);
      }
    }

    if (masters_deleted || workfiles_deleted) {
      this.log.log(
        `[janitor] org ${orgId}: ${masters_deleted} masters, ${workfiles_deleted} arquivos de trabalho apagados (cota ${quota_percent ?? '?'}%)`,
      );
    }
    return { masters_deleted, workfiles_deleted, quota_percent, alerted };
  }

  private async cleanMasters(orgId: string): Promise<number> {
    const cutoff = new Date(Date.now() - MASTER_TTL_DAYS * DAY_MS).toISOString();
    const { data } = await this.supabase.adminClient
      .from('content_jobs')
      .select('id, drive_file_id')
      .eq('org_id', orgId)
      .eq('status', 'done')
      .is('master_deleted_at', null)
      .lt('updated_at', cutoff)
      .limit(200);
    const jobs = (data ?? []) as Array<{ id: string; drive_file_id: string | null }>;
    let n = 0;
    for (const j of jobs) {
      try {
        if (j.drive_file_id) await this.drive.deleteFile(orgId, j.drive_file_id);
        await this.supabase.adminClient
          .from('content_jobs')
          .update({ master_deleted_at: new Date().toISOString() })
          .eq('id', j.id)
          .eq('org_id', orgId);
        n += 1;
      } catch (err) {
        this.log.warn(`[janitor] master job ${j.id}: ${String(err)}`);
      }
    }
    return n;
  }

  private async cleanWorkFiles(orgId: string): Promise<number> {
    const cutoff = new Date(Date.now() - WORKFILE_TTL_DAYS * DAY_MS).toISOString();
    const { data } = await this.supabase.adminClient
      .from('clips')
      .select('id, drive_file_id')
      .eq('org_id', orgId)
      .eq('status', 'publicado')
      .is('work_file_deleted_at', null)
      .lt('updated_at', cutoff)
      .limit(200);
    const clips = (data ?? []) as Array<{ id: string; drive_file_id: string | null }>;
    let n = 0;
    for (const c of clips) {
      try {
        if (c.drive_file_id) await this.drive.deleteFile(orgId, c.drive_file_id);
        await this.supabase.adminClient
          .from('clips')
          .update({ work_file_deleted_at: new Date().toISOString() })
          .eq('id', c.id)
          .eq('org_id', orgId);
        n += 1;
      } catch (err) {
        this.log.warn(`[janitor] workfile clip ${c.id}: ${String(err)}`);
      }
    }
    return n;
  }

  // ── Alerta de cota (WhatsApp pros gestores) ───────────────

  private async alertQuota(orgId: string, percent: number): Promise<boolean> {
    const key = `${orgId}:${new Date().toISOString().slice(0, 10)}`;
    if (this.alertedToday.has(key)) return false;
    this.alertedToday.add(key);

    const text =
      `*⚠️ Studio de Cortes — Drive quase cheio*\n\n` +
      `O Shared Drive de cortes está em *${percent}%* de uso. ` +
      `Libere espaço ou aumente a cota pra não travar novos uploads.`;
    let delivered = 0;
    try {
      const mgrs = (await this.managers.listActive(orgId)) as ManagerForAlert[];
      for (const m of mgrs) {
        try {
          await this.sendWhatsApp(orgId, m, text);
          delivered += 1;
        } catch (err) {
          this.log.warn(`[janitor] alerta gestor ${m.id}: ${String(err)}`);
        }
      }
    } catch (err) {
      this.log.warn(`[janitor] listActive falhou: ${String(err)}`);
    }
    return delivered > 0;
  }

  private async sendWhatsApp(orgId: string, manager: ManagerForAlert, text: string): Promise<void> {
    const channelId = manager.channel_id ?? (await this.resolveDefaultChannel(orgId));
    if (!channelId) throw new Error('sem canal default');
    const channel = await this.dispatcher.getChannel(orgId, channelId);
    if (channel.status !== 'active') throw new Error(`canal ${channelId} status=${channel.status}`);
    const provider = this.dispatcher.getProvider(channel.channel_type);
    await provider.sendMessage({
      channel,
      to: manager.phone,
      content_type: 'text',
      content: { body: text },
    });
  }

  private async resolveDefaultChannel(orgId: string): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('channels')
      .select('id')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .in('channel_type', ['baileys', 'zapi', 'whatsapp_free', 'whatsapp_cloud'])
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  }
}
