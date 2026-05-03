import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Channel } from '@eclick-active/shared';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { TikTokProvider } from '../../../common/channels/providers/tiktok/tiktok.provider';
import type { TikTokCredentials } from '../../../common/channels/providers/tiktok/tiktok.types';
import { encryptToken } from '../../calendar-integrations/crypto.helper';

const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1h
const REFRESH_THRESHOLD_MS = 6 * 60 * 60 * 1000; // refresh quando faltar <6h

/**
 * TikTok access_tokens expiram em 24h. Worker checa a cada 1h se algum
 * canal tem token expirando em <6h e refresh_token ainda válido (365d).
 *
 * Falhas: marca status='error' + last_error pra forçar reconexão.
 */
@Injectable()
export class TikTokTokenRefreshWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TikTokTokenRefreshWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly tiktok: TikTokProvider,
  ) {}

  onModuleInit(): void {
    if (process.env.DISABLE_TIKTOK_REFRESH === 'true') return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        this.logger.warn(
          `tick falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, TICK_INTERVAL_MS);
    // Roda 2min após boot pra não competir com startup
    setTimeout(() => void this.tick().catch(() => {}), 2 * 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) return; // sem env, nada a fazer

    const horizon = new Date(Date.now() + REFRESH_THRESHOLD_MS).toISOString();
    const { data, error } = await this.supabase.adminClient
      .from('channels')
      .select('*')
      .eq('channel_type', 'tiktok')
      .eq('status', 'active')
      .lte('credentials->>token_expires_at', horizon);
    if (error) {
      this.logger.warn(`Query falhou: ${error.message}`);
      return;
    }

    const channels = (data ?? []) as Channel[];
    if (channels.length === 0) return;
    this.logger.log(`Refreshing ${channels.length} TikTok token(s)`);

    for (const channel of channels) {
      try {
        const decryptedCreds = this.tiktok.decryptCredentials(channel.credentials);
        if (!decryptedCreds.refresh_token_encrypted) {
          await this.markError(channel.id, 'sem refresh_token');
          continue;
        }

        const refreshed = await this.tiktok.refreshAccessToken({
          refresh_token: decryptedCreds.refresh_token_encrypted,
          client_key: clientKey,
          client_secret: clientSecret,
        });

        const accessEnc = encryptToken(refreshed.access_token);
        const refreshEnc = encryptToken(refreshed.refresh_token);
        if (!accessEnc || !refreshEnc) {
          await this.markError(channel.id, 'falha ao criptografar tokens');
          continue;
        }

        const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
        const newCreds: TikTokCredentials = {
          ...decryptedCreds,
          access_token_encrypted: accessEnc,
          refresh_token_encrypted: refreshEnc,
          token_expires_at: expiresAt,
        };

        await this.supabase.adminClient
          .from('channels')
          .update({ credentials: newCreds, status: 'active' })
          .eq('id', channel.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Refresh channel ${channel.id} falhou: ${msg}`);
        await this.markError(channel.id, msg.slice(0, 200));
      }
    }
  }

  private async markError(channelId: string, message: string): Promise<void> {
    await this.supabase.adminClient
      .from('channels')
      .update({ status: 'error', config: { last_error: message } })
      .eq('id', channelId);
  }
}
