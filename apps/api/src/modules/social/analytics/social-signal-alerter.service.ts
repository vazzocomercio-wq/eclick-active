import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../../common/channels/channel-dispatcher.service';
import { SlackNotifierService } from '../../../common/slack/slack-notifier.service';
import { AlertManagersService } from '../../alerts/alert-managers.service';
import type { SocialSignal } from './analytics.types';

interface ManagerForAlert {
  id: string;
  name: string;
  phone: string;
  channel_id: string | null;
  preferences: Record<string, unknown>;
}

const SIGNAL_TYPE_LABEL: Record<string, string> = {
  hit_post: '🎯 Post bombando',
  flop_post: '⚠️ Post abaixo da média',
  best_pillar: '📈 Pilar campeão identificado',
  best_time_window: '⏰ Melhor horário identificado',
  best_hashtag: '🔥 Hashtag campeã',
  declining_trend: '📉 Queda de performance',
  engagement_spike: '⚡ Pico de engajamento',
};

/**
 * Despacha alertas WhatsApp pra alert_managers ativos quando
 * social_signals qualificados são detectados.
 *
 * Critérios pra notificar:
 *   - severity = 'critical' → sempre
 *   - severity = 'warning' → se signal_type ∈ {flop_post, declining_trend}
 *   - severity = 'info' + signal_type = 'hit_post' → se delta_pct > 200%
 *     (post REALMENTE excepcional, não só bom)
 *   - Outros 'info' não notificam (poluiria muito)
 *
 * Reaproveita:
 *   - alert_managers (cadastro de gestores que recebem)
 *   - alert_deliveries (log de envios — coluna social_signal_id da M059)
 *   - ChannelDispatcherService (dispara via Baileys/Z-API)
 *
 * Diferente do AlertEngineService de ads:
 *   - Não usa routing rules (simplifica MVP — todo manager ativo recebe
 *     todos os signals qualificados). Refinamento via routing rules
 *     dedicadas fica pra fase 2.
 *   - Sem digest/business hours filter no MVP (pode adicionar via
 *     manager.preferences.quiet_hours futuramente).
 */
@Injectable()
export class SocialSignalAlerter {
  private readonly log = new Logger(SocialSignalAlerter.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly managers: AlertManagersService,
    private readonly slack: SlackNotifierService,
  ) {}

  /**
   * Avalia signal e dispara notificações se qualificado.
   * Best-effort: erros não derrubam o detector.
   */
  async maybeNotify(signal: SocialSignal): Promise<{ delivered: number; skipped: boolean }> {
    if (!this.shouldNotify(signal)) return { delivered: 0, skipped: true };

    let delivered = 0;
    try {
      // WhatsApp pros managers
      const managers = await this.managers.listActive(signal.org_id);
      if (managers.length > 0) {
        const text = this.formatMessage(signal);
        for (const m of managers) {
          try {
            await this.sendToManager(signal, m as ManagerForAlert, text);
            delivered += 1;
          } catch (err) {
            this.log.warn(
              `Manager ${m.id} (${m.name}) falhou: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }

      // Slack webhooks (best-effort)
      try {
        const slackResult = await this.slack.notify(signal.org_id, {
          category: 'social',
          severity: signal.severity,
          title: signal.title,
          description: signal.description ?? undefined,
          fields: this.buildSlackFields(signal),
          url: process.env.PUBLIC_APP_URL
            ? `${process.env.PUBLIC_APP_URL}/social/relatorios`
            : undefined,
        });
        delivered += slackResult.delivered;
      } catch (err) {
        this.log.warn(`Slack notify falhou: ${String(err)}`);
      }

      return { delivered, skipped: false };
    } catch (err) {
      this.log.warn(`maybeNotify falhou (signal=${signal.id}): ${String(err)}`);
      return { delivered, skipped: true };
    }
  }

  private buildSlackFields(
    signal: SocialSignal,
  ): Array<{ label: string; value: string }> {
    const out: Array<{ label: string; value: string }> = [];
    if (signal.delta_pct !== null && signal.delta_pct !== undefined) {
      out.push({
        label: 'Delta',
        value: `${signal.delta_pct > 0 ? '+' : ''}${signal.delta_pct}%`,
      });
    }
    if (signal.metric_value !== null && signal.metric_name) {
      const formatted =
        signal.metric_name === 'engagement_rate'
          ? `${(signal.metric_value * 100).toFixed(2)}%`
          : signal.metric_value.toLocaleString('pt-BR');
      out.push({ label: signal.metric_name, value: formatted });
    }
    return out;
  }

  // ─── decisão ─────────────────────────────────────

  private shouldNotify(signal: SocialSignal): boolean {
    if (signal.severity === 'critical') return true;
    if (signal.severity === 'warning') {
      return ['flop_post', 'declining_trend'].includes(signal.signal_type);
    }
    if (signal.severity === 'info' && signal.signal_type === 'hit_post') {
      return (signal.delta_pct ?? 0) >= 200;
    }
    return false;
  }

  // ─── despacho ────────────────────────────────────

  private async sendToManager(
    signal: SocialSignal,
    manager: ManagerForAlert,
    text: string,
  ): Promise<void> {
    const channelId = manager.channel_id ?? (await this.resolveDefaultChannel(signal.org_id));
    if (!channelId) {
      throw new Error('Sem canal default disponível pra org');
    }

    const channel = await this.dispatcher.getChannel(signal.org_id, channelId);
    if (channel.status !== 'active') {
      throw new Error(`canal ${channelId} status=${channel.status}`);
    }
    const provider = this.dispatcher.getProvider(channel.channel_type);

    // Cria delivery row em pending (audit + retry tracking)
    const { data: deliveryRow } = await this.supabase.adminClient
      .from('alert_deliveries')
      .insert({
        org_id: signal.org_id,
        manager_id: manager.id,
        social_signal_id: signal.id,
        signal_source: 'social',
        delivery_mode: 'immediate',
        message_text: text,
        channel_id: channelId,
        status: 'queued',
        narrator: 'template',
      })
      .select('id')
      .single();
    const deliveryId = (deliveryRow as { id?: string } | null)?.id ?? null;

    try {
      const result = await provider.sendMessage({
        channel,
        to: manager.phone,
        content_type: 'text',
        content: { body: text },
      });
      if (deliveryId) {
        await this.supabase.adminClient
          .from('alert_deliveries')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            channel_message_id: result.channel_message_id ?? null,
          })
          .eq('id', deliveryId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (deliveryId) {
        await this.supabase.adminClient
          .from('alert_deliveries')
          .update({
            status: 'failed',
            error_message: msg.slice(0, 500),
          })
          .eq('id', deliveryId);
      }
      throw err;
    }
  }

  private async resolveDefaultChannel(orgId: string): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('channels')
      .select('id')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .in('channel_type', ['baileys', 'zapi'])
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  }

  // ─── formatter ───────────────────────────────────

  private formatMessage(signal: SocialSignal): string {
    const label =
      SIGNAL_TYPE_LABEL[signal.signal_type] ?? `Alerta: ${signal.signal_type}`;
    const lines: string[] = [];

    lines.push(`*${label}*`);
    lines.push('');
    lines.push(signal.title);
    if (signal.description) {
      lines.push('');
      lines.push(signal.description);
    }

    if (signal.delta_pct !== null && signal.delta_pct !== undefined) {
      const sign = signal.delta_pct > 0 ? '+' : '';
      lines.push('');
      lines.push(`📊 Delta: ${sign}${signal.delta_pct}%`);
    }

    if (signal.metric_value !== null && signal.metric_name) {
      const formatted =
        signal.metric_name === 'engagement_rate'
          ? `${(signal.metric_value * 100).toFixed(2)}%`
          : signal.metric_value.toLocaleString('pt-BR');
      lines.push(`Métrica (${signal.metric_name}): ${formatted}`);
      if (signal.benchmark_value) {
        const bench =
          signal.metric_name === 'engagement_rate'
            ? `${(signal.benchmark_value * 100).toFixed(2)}%`
            : signal.benchmark_value.toLocaleString('pt-BR');
        lines.push(`Benchmark: ${bench}`);
      }
    }

    lines.push('');
    lines.push('Acesse Social AI Studio pra agir.');

    return lines.join('\n');
  }
}
