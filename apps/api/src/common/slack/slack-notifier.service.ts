import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface SlackWebhook {
  id: string;
  org_id: string;
  name: string;
  webhook_url: string;
  channel_name: string | null;
  notify_social: boolean;
  notify_ad: boolean;
  notify_sac: boolean;
  min_severity: 'info' | 'warning' | 'critical';
  is_active: boolean;
}

export type NotifyCategory = 'social' | 'ad' | 'sac';
export type NotifySeverity = 'info' | 'warning' | 'critical';

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  fields?: Array<{ type: string; text: string }>;
  elements?: unknown[];
}

export interface SlackPayload {
  text: string;
  blocks?: SlackBlock[];
}

const SEVERITY_RANK: Record<NotifySeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

const SEVERITY_EMOJI: Record<NotifySeverity, string> = {
  info: ':information_source:',
  warning: ':warning:',
  critical: ':rotating_light:',
};

const CATEGORY_LABEL: Record<NotifyCategory, string> = {
  social: 'Social AI',
  ad: 'Ads Intelligence',
  sac: 'SAC',
};

/**
 * Notifier genérico que dispara mensagens pra Incoming Webhooks do Slack.
 * Cada org cadastra N webhooks com filtros (categoria + severity mínima).
 *
 * Slack Incoming Webhook URLs são públicas mas org-bound — a URL é o
 * "secret". Não precisa OAuth nem token complexo. Usuário cria em
 * Slack workspace → Apps → Incoming Webhooks → cola URL aqui.
 *
 * Filtros: dispara só se webhook.notify_<category>=true E
 * severity >= webhook.min_severity. Best-effort: erros marcam
 * last_error mas não derrubam o caller.
 */
@Injectable()
export class SlackNotifierService {
  private readonly log = new Logger(SlackNotifierService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Envia notificação pra todos webhooks da org que casam com os filtros.
   * Retorna número de webhooks que receberam com sucesso.
   */
  async notify(
    orgId: string,
    args: {
      category: NotifyCategory;
      severity: NotifySeverity;
      title: string;
      description?: string;
      url?: string;
      fields?: Array<{ label: string; value: string }>;
    },
  ): Promise<{ delivered: number; skipped: number }> {
    const webhooks = await this.listMatching(orgId, args.category, args.severity);
    if (webhooks.length === 0) return { delivered: 0, skipped: 0 };

    const payload = this.buildPayload(args);
    let delivered = 0;
    let skipped = 0;

    for (const wh of webhooks) {
      try {
        const ok = await this.send(wh, payload);
        if (ok) {
          delivered += 1;
          await this.markUsed(wh.id);
        } else {
          skipped += 1;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`Slack webhook ${wh.id} falhou: ${msg}`);
        await this.markError(wh.id, msg);
        skipped += 1;
      }
    }
    return { delivered, skipped };
  }

  // ─── CRUD ──────────────────────────────────────

  async list(orgId: string): Promise<SlackWebhook[]> {
    const { data } = await this.supabase.adminClient
      .from('slack_webhooks')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    return (data ?? []) as SlackWebhook[];
  }

  async create(
    orgId: string,
    dto: Partial<SlackWebhook> & { name: string; webhook_url: string },
  ): Promise<SlackWebhook> {
    const { data, error } = await this.supabase.adminClient
      .from('slack_webhooks')
      .insert({ ...dto, org_id: orgId })
      .select('*')
      .single();
    if (error) throw error;
    return data as SlackWebhook;
  }

  async update(
    orgId: string,
    id: string,
    patch: Partial<SlackWebhook>,
  ): Promise<SlackWebhook> {
    const { data, error } = await this.supabase.adminClient
      .from('slack_webhooks')
      .update(patch)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as SlackWebhook;
  }

  async delete(orgId: string, id: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('slack_webhooks')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);
    if (error) throw error;
  }

  async testWebhook(orgId: string, id: string): Promise<boolean> {
    const wh = (await this.list(orgId)).find((w) => w.id === id);
    if (!wh) return false;
    return this.send(wh, {
      text: '✅ Teste de conexão Slack — Active CRM',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Active CRM* — webhook configurado com sucesso! 🎉',
          },
        },
      ],
    });
  }

  // ─── helpers ────────────────────────────────────

  private async listMatching(
    orgId: string,
    category: NotifyCategory,
    severity: NotifySeverity,
  ): Promise<SlackWebhook[]> {
    const { data } = await this.supabase.adminClient
      .from('slack_webhooks')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true);
    const all = (data ?? []) as SlackWebhook[];
    return all.filter((wh) => {
      const categoryOk =
        (category === 'social' && wh.notify_social) ||
        (category === 'ad' && wh.notify_ad) ||
        (category === 'sac' && wh.notify_sac);
      const severityOk = SEVERITY_RANK[severity] >= SEVERITY_RANK[wh.min_severity];
      return categoryOk && severityOk;
    });
  }

  private buildPayload(args: {
    category: NotifyCategory;
    severity: NotifySeverity;
    title: string;
    description?: string;
    url?: string;
    fields?: Array<{ label: string; value: string }>;
  }): SlackPayload {
    const emoji = SEVERITY_EMOJI[args.severity];
    const tag = CATEGORY_LABEL[args.category];
    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji} *${tag}* — ${args.title}`,
        },
      },
    ];
    if (args.description) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: args.description },
      });
    }
    if (args.fields && args.fields.length > 0) {
      blocks.push({
        type: 'section',
        fields: args.fields.map((f) => ({
          type: 'mrkdwn',
          text: `*${f.label}*\n${f.value}`,
        })),
      });
    }
    if (args.url) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Abrir no Active' },
            url: args.url,
          },
        ],
      });
    }
    return {
      text: `${tag}: ${args.title}`,
      blocks,
    };
  }

  private async send(wh: SlackWebhook, payload: SlackPayload): Promise<boolean> {
    const res = await fetch(wh.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Slack ${res.status}: ${text.slice(0, 200)}`);
    }
    return true;
  }

  private async markUsed(id: string): Promise<void> {
    await this.supabase.adminClient
      .from('slack_webhooks')
      .update({ last_used_at: new Date().toISOString(), last_error: null })
      .eq('id', id);
  }

  private async markError(id: string, error: string): Promise<void> {
    await this.supabase.adminClient
      .from('slack_webhooks')
      .update({ last_error: error.slice(0, 500) })
      .eq('id', id);
  }
}
