import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../../common/channels/channel-dispatcher.service';
import { SlackNotifierService } from '../../../common/slack/slack-notifier.service';
import { AlertManagersService } from '../../alerts/alert-managers.service';
import type { TrendSignal } from './trends.types';

interface ManagerForAlert {
  id: string;
  name: string;
  phone: string;
  channel_id: string | null;
}

/**
 * TR-4 — alerta de tendência. Manda um DIGEST diário do Radar (sinais fortes +
 * nº de pautas novas) via Slack + WhatsApp pros gestores ativos. Best-effort:
 * erros nunca derrubam o worker. Reaproveita a infra do SocialSignalAlerter
 * (alert_managers + ChannelDispatcher + SlackNotifier).
 *
 * Disparado só pelo worker (1×/dia) — geração manual na tela NÃO alerta
 * (o usuário já está olhando).
 */
@Injectable()
export class TrendsAlerterService {
  private readonly log = new Logger(TrendsAlerterService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly managers: AlertManagersService,
    private readonly slack: SlackNotifierService,
  ) {}

  async alertDigest(
    orgId: string,
    topSignals: TrendSignal[],
    briefCount: number,
  ): Promise<{ delivered: number }> {
    const actionable = topSignals
      .filter((s) =>
        ['format_rising', 'search_spike', 'topic_rising'].includes(s.signal_type),
      )
      .slice(0, 3);
    if (!actionable.length && briefCount === 0) return { delivered: 0 };

    const title = '📡 Radar de Conteúdo — tendências do dia';
    const bullets = actionable.map((s) => `• ${s.title}`).join('\n');
    const briefLine =
      briefCount > 0 ? `\n\n✨ ${briefCount} pauta(s) nova(s) prontas no Radar.` : '';
    const body = `${bullets}${briefLine}`.trim();
    const appUrl = process.env.PUBLIC_APP_URL ?? process.env.FRONTEND_BASE_URL;
    let delivered = 0;

    // Slack (best-effort)
    try {
      const r = await this.slack.notify(orgId, {
        category: 'social',
        severity: 'info',
        title,
        description: body,
        url: appUrl ? `${appUrl}/social/tendencias` : undefined,
      });
      delivered += r.delivered;
    } catch (err) {
      this.log.warn(`slack digest falhou: ${String(err)}`);
    }

    // WhatsApp pros gestores ativos
    try {
      const mgrs = (await this.managers.listActive(orgId)) as ManagerForAlert[];
      if (mgrs.length) {
        const text = `*${title}*\n\n${body}\n\nAbra o Radar de Conteúdo pra ver as pautas.`;
        for (const m of mgrs) {
          try {
            await this.sendWhatsApp(orgId, m, text);
            delivered += 1;
          } catch (err) {
            this.log.warn(`manager ${m.id} falhou: ${String(err)}`);
          }
        }
      }
    } catch (err) {
      this.log.warn(`whatsapp digest falhou: ${String(err)}`);
    }

    return { delivered };
  }

  private async sendWhatsApp(
    orgId: string,
    manager: ManagerForAlert,
    text: string,
  ): Promise<void> {
    const channelId = manager.channel_id ?? (await this.resolveDefaultChannel(orgId));
    if (!channelId) throw new Error('sem canal default');
    const channel = await this.dispatcher.getChannel(orgId, channelId);
    if (channel.status !== 'active') {
      throw new Error(`canal ${channelId} status=${channel.status}`);
    }
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
