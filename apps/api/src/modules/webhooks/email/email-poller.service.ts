import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Channel } from '@eclick-active/shared';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { EmailProvider } from '../../../common/channels/providers/email/email.provider';
import type {
  EmailCredentials,
  ParsedEmail,
} from '../../../common/channels/providers/email/email.types';
import { EmailWebhookService } from './email-webhook.service';

const POLL_INTERVAL_MS = 60_000; // 60s por canal
const FIRST_POLL_DELAY_MS = 30_000; // 30s após boot
const MAX_RETRIES_BEFORE_PAUSE = 3;
const FIRST_TIME_DAYS_BACK = 7;

interface ChannelState {
  channelId: string;
  timer: NodeJS.Timeout | null;
  consecutiveErrors: number;
  isFirstPoll: boolean;
  inFlight: boolean;
}

/**
 * Worker que faz pull IMAP por canal de email.
 *
 * Ciclo de vida:
 *   - onModuleInit: lista canais email ativos e inicia polling pra cada
 *   - poll(channel): conecta IMAP → busca não-lidas (UNSEEN) → parse →
 *     dispara EmailWebhookService.handleParsed → marca \\Seen
 *   - 3 erros consecutivos: pausa channel (status='error'), notifica
 *   - Quando um canal é criado/atualizado, startPolling() pode ser
 *     chamado externamente pra começar imediato
 *
 * Não usa IMAP IDLE (mais simples + suficiente pra MVP). Pull a cada
 * 60s comporta latência aceitável pra email.
 */
@Injectable()
export class EmailPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailPollerService.name);
  private readonly states = new Map<string, ChannelState>();
  private booted = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly emailProvider: EmailProvider,
    private readonly webhookService: EmailWebhookService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.DISABLE_EMAIL_POLLER === 'true') {
      this.logger.warn('Poller email desabilitado via env');
      return;
    }
    setTimeout(() => {
      void this.bootAllChannels().catch((err) => {
        this.logger.error(
          `Falha ao bootar email channels: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, FIRST_POLL_DELAY_MS);
  }

  onModuleDestroy(): void {
    for (const state of this.states.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.states.clear();
  }

  // ──────────────────────────────────────────────────────────
  // Boot — descobre todos os canais email ativos e inicia polling
  // ──────────────────────────────────────────────────────────

  private async bootAllChannels(): Promise<void> {
    if (this.booted) return;
    const { data, error } = await this.supabase.adminClient
      .from('channels')
      .select('id')
      .eq('channel_type', 'email')
      .eq('status', 'active');
    if (error) {
      this.logger.error(`bootAllChannels falhou: ${error.message}`);
      return;
    }
    const channels = (data ?? []) as Array<{ id: string }>;
    for (const ch of channels) {
      this.startPolling(ch.id, true);
    }
    this.booted = true;
    this.logger.log(`Email poller bootado — ${channels.length} canais ativos`);
  }

  /**
   * Inicia polling pra um canal. Idempotente — se já existe state, no-op.
   * Chamado externamente quando um canal é criado/reativado.
   */
  startPolling(channelId: string, isFirstTime = false): void {
    if (this.states.has(channelId)) return;
    const state: ChannelState = {
      channelId,
      timer: null,
      consecutiveErrors: 0,
      isFirstPoll: isFirstTime,
      inFlight: false,
    };
    this.states.set(channelId, state);
    this.scheduleTick(state, 1000); // primeira execução em 1s
    this.logger.log(`Polling iniciado pra channel ${channelId}`);
  }

  /** Para polling de um canal — chamado quando canal é deletado/pausado. */
  stopPolling(channelId: string): void {
    const state = this.states.get(channelId);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    this.states.delete(channelId);
    this.logger.log(`Polling parado pra channel ${channelId}`);
  }

  // ──────────────────────────────────────────────────────────
  // Tick — uma rodada de pull pra um canal
  // ──────────────────────────────────────────────────────────

  private scheduleTick(state: ChannelState, delayMs: number): void {
    state.timer = setTimeout(() => {
      void this.tick(state).catch((err) => {
        this.logger.error(
          `tick channel ${state.channelId} falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, delayMs);
  }

  private async tick(state: ChannelState): Promise<void> {
    if (state.inFlight) {
      // Outro tick rodando — agenda próximo e retorna
      this.scheduleTick(state, POLL_INTERVAL_MS);
      return;
    }
    state.inFlight = true;
    try {
      const channel = await this.fetchChannel(state.channelId);
      if (!channel) {
        // Canal removido do banco — para polling
        this.stopPolling(state.channelId);
        return;
      }
      if (channel.status !== 'active') {
        // Canal pausado/erro — agenda check daqui a 5min
        this.scheduleTick(state, 5 * 60_000);
        return;
      }

      await this.pollChannel(channel, state.isFirstPoll);
      state.isFirstPoll = false;
      state.consecutiveErrors = 0;

      await this.supabase.adminClient
        .from('channels')
        .update({ last_webhook_at: new Date().toISOString() })
        .eq('id', channel.id);
    } catch (err) {
      state.consecutiveErrors++;
      this.logger.warn(
        `Poll channel ${state.channelId} erro #${state.consecutiveErrors}: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (state.consecutiveErrors >= MAX_RETRIES_BEFORE_PAUSE) {
        await this.markChannelError(
          state.channelId,
          err instanceof Error ? err.message : 'Erro de conexão IMAP',
        );
        this.stopPolling(state.channelId);
        return;
      }
    } finally {
      state.inFlight = false;
      if (this.states.has(state.channelId)) {
        this.scheduleTick(state, POLL_INTERVAL_MS);
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // Pull IMAP — conecta, busca não-lidas, parse, dispatch
  // ──────────────────────────────────────────────────────────

  private async pollChannel(channel: Channel, isFirstTime: boolean): Promise<void> {
    const creds = this.emailProvider.decryptCredentials(channel.credentials);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ImapFlow } = require('imapflow') as typeof import('imapflow');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mailparser = require('mailparser') as typeof import('mailparser');

    const folder = creds.folder ?? 'INBOX';

    const client = new ImapFlow({
      host: creds.imap_host,
      port: creds.imap_port,
      secure: creds.imap_tls,
      auth: { user: creds.email, pass: creds.password_encrypted },
      logger: false,
    });

    await client.connect();
    try {
      const lock = await client.getMailboxLock(folder);
      try {
        // Critério de busca: primeira vez = últimos N dias; depois = só UNSEEN
        const searchCriteria: Record<string, unknown> = isFirstTime
          ? {
              seen: false,
              since: new Date(Date.now() - FIRST_TIME_DAYS_BACK * 86_400_000),
            }
          : { seen: false };

        const uids = await client.search(searchCriteria as never, { uid: true });
        if (!uids || uids.length === 0) return;

        // Limita a 50 por tick pra não sobrecarregar
        const toProcess = uids.slice(0, 50);
        this.logger.log(`Channel ${channel.id} — ${toProcess.length} email(s) novo(s)`);

        for (const uid of toProcess) {
          try {
            const msg = await client.fetchOne(
              uid,
              { source: true, envelope: true, uid: true },
              { uid: true },
            );
            if (!msg || msg.source === undefined) continue;

            const parsed = await mailparser.simpleParser(msg.source as Buffer);

            const parsedEmail: ParsedEmail = {
              uid,
              message_id: parsed.messageId ?? `<imap-${uid}@local>`,
              in_reply_to: parsed.inReplyTo ?? null,
              references: this.normalizeReferences(parsed.references),
              subject: parsed.subject ?? '(sem assunto)',
              from: this.parseAddress(parsed.from),
              to: this.parseAddressList(parsed.to),
              cc: this.parseAddressList(parsed.cc),
              date: parsed.date ?? new Date(),
              text: (parsed.text ?? '').trim(),
              html: parsed.html === false ? null : parsed.html ?? null,
              attachments: (parsed.attachments ?? []).map((a) => ({
                filename: a.filename ?? 'anexo',
                content_type: a.contentType ?? 'application/octet-stream',
                size: a.size ?? 0,
              })),
            };

            // Dispatch pro WebhookService
            await this.webhookService.handleParsed(channel, parsedEmail);

            // Marca como lida no IMAP
            await client.messageFlagsAdd(
              { uid: String(uid) },
              ['\\Seen'],
              { uid: true },
            );
          } catch (err) {
            this.logger.warn(
              `Falha ao processar email uid=${uid}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      try {
        await client.logout();
      } catch {
        /* swallow */
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  private async fetchChannel(channelId: string): Promise<Channel | null> {
    const { data, error } = await this.supabase.adminClient
      .from('channels')
      .select('*')
      .eq('id', channelId)
      .maybeSingle();
    if (error) {
      this.logger.error(`fetchChannel falhou: ${error.message}`);
      return null;
    }
    return (data as Channel | null) ?? null;
  }

  private async markChannelError(channelId: string, message: string): Promise<void> {
    await this.supabase.adminClient
      .from('channels')
      .update({
        status: 'error',
        config: { last_error: message.slice(0, 500), last_error_at: new Date().toISOString() },
      })
      .eq('id', channelId);
  }

  private parseAddress(
    addr: { value?: Array<{ address?: string; name?: string }> } | undefined,
  ): { email: string; name: string | null } {
    const v = addr?.value?.[0];
    return {
      email: v?.address ?? '',
      name: v?.name ?? null,
    };
  }

  private parseAddressList(
    addr: { value?: Array<{ address?: string }> } | { value?: Array<{ address?: string }> }[] | undefined,
  ): string[] {
    if (!addr) return [];
    const list = Array.isArray(addr) ? addr : [addr];
    const out: string[] = [];
    for (const a of list) {
      for (const v of a.value ?? []) {
        if (v.address) out.push(v.address);
      }
    }
    return out;
  }

  private normalizeReferences(ref: string | string[] | undefined): string[] {
    if (!ref) return [];
    if (Array.isArray(ref)) return ref;
    return ref.split(/\s+/).filter(Boolean);
  }
}
