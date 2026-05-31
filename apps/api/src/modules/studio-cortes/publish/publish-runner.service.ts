import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../../common/channels/channel-dispatcher.service';
import { AlertManagersService } from '../../alerts/alert-managers.service';
import { InstagramGraphProvider } from '../../social/publishing/providers/instagram-graph.provider';
import { TikTokBusinessProvider } from '../../social/publishing/providers/tiktok.provider';
import type { PublishInput, PublishResult } from '../../social/publishing/publishing.types';
import { CortesDriveClient } from '../cortes-drive.client';
import { YouTubeShortsProvider } from './youtube-shorts.provider';
import type { Clip, ClipPost } from '../studio-cortes.types';

interface ManagerForAlert {
  id: string;
  name: string;
  phone: string;
  channel_id: string | null;
}

/**
 * PublishRunner — publica os cortes nas redes de forma NATIVA, reusando os
 * providers do Social AI Studio (Instagram/TikTok) + YouTubeShortsProvider novo.
 * Opera por clip_post (1 linha por plataforma). Idempotente: nunca republica
 * um post que já tem external_post_id.
 */
@Injectable()
export class PublishRunnerService {
  private readonly log = new Logger(PublishRunnerService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly instagram: InstagramGraphProvider,
    private readonly tiktok: TikTokBusinessProvider,
    private readonly youtube: YouTubeShortsProvider,
    private readonly drive: CortesDriveClient,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly managers: AlertManagersService,
  ) {}

  /** Publica todos os clip_posts "devidos" de um corte e atualiza o status do corte. */
  async publishClip(orgId: string, clipId: string): Promise<{ published: number; failed: number }> {
    const { data: clipData } = await this.supabase.adminClient
      .from('clips')
      .select('*')
      .eq('id', clipId)
      .eq('org_id', orgId)
      .maybeSingle();
    const clip = clipData as Clip | null;
    if (!clip) return { published: 0, failed: 0 };
    if (clip.status !== 'aprovado' && clip.status !== 'agendado') {
      return { published: 0, failed: 0 };
    }

    const { data: postsData } = await this.supabase.adminClient
      .from('clip_posts')
      .select('*')
      .eq('clip_id', clipId)
      .eq('org_id', orgId);
    const posts = (postsData ?? []) as (ClipPost & { publish_attempts?: number })[];

    const videoUrl = await this.resolveVideoUrl(orgId, clip);
    if (!videoUrl) {
      this.log.warn(`[publish] clip ${clipId} sem URL de vídeo — pulando`);
      return { published: 0, failed: 0 };
    }
    const brandId = await this.resolveBrandId(orgId);

    let published = 0;
    let failed = 0;
    for (const post of posts) {
      if (post.external_post_id || post.status === 'publicado') continue; // idempotência
      if ((post.publish_attempts ?? 0) >= 3) continue; // backoff
      if (!this.isDue(clip, post)) continue; // agendamento

      const result = await this.publishPost(orgId, clip, post, videoUrl);
      if (result.success) published += 1;
      else failed += 1;
    }

    await this.recomputeClipStatus(orgId, clipId);
    return { published, failed };
  }

  /** Publica um clip_post numa plataforma. */
  private async publishPost(
    orgId: string,
    clip: Clip,
    post: ClipPost & { publish_attempts?: number },
    videoUrl: string,
  ): Promise<PublishResult> {
    const caption = buildCaption(post.copy, post.hashtags);
    let result: PublishResult;

    try {
      if (post.platform === 'instagram') {
        const input: PublishInput = {
          caption,
          image_urls: [],
          is_carousel: false,
          video_url: videoUrl,
        };
        result = await this.instagram.publish(orgId, input, await this.resolveBrandId(orgId));
      } else if (post.platform === 'tiktok') {
        const input: PublishInput = {
          caption,
          image_urls: [],
          is_carousel: false,
          video_url: videoUrl,
        };
        result = await this.tiktok.publish(orgId, input, await this.resolveBrandId(orgId));
      } else {
        // youtube
        const title = (post.title || clip.title || 'Corte').slice(0, 100);
        const description = buildYouTubeDescription(post.copy, post.hashtags);
        result = await this.youtube.publish(orgId, {
          video_url: videoUrl,
          title,
          description,
          tags: post.hashtags,
          privacy: 'public',
        });
      }
    } catch (err) {
      result = {
        success: false,
        error_code: 'runner_error',
        error_message: err instanceof Error ? err.message : String(err),
        provider_response: {},
      };
    }

    if (result.success) {
      await this.supabase.adminClient
        .from('clip_posts')
        .update({
          status: 'publicado',
          external_post_id: result.external_post_id ?? null,
          external_post_url: result.external_post_url ?? null,
          published_at: new Date().toISOString(),
          error: null,
        })
        .eq('id', post.id)
        .eq('org_id', orgId);
      this.log.log(`[publish] ${post.platform} ok → ${result.external_post_id} (clip ${clip.id})`);
    } else {
      await this.supabase.adminClient
        .from('clip_posts')
        .update({
          status: 'falhou',
          error: result.error_message ?? 'erro',
          publish_attempts: (post.publish_attempts ?? 0) + 1,
        })
        .eq('id', post.id)
        .eq('org_id', orgId);
      this.log.warn(`[publish] ${post.platform} falhou (clip ${clip.id}): ${result.error_message}`);
      void this.alertFailure(orgId, clip, post.platform, result.error_message ?? 'erro').catch(() => {});
    }
    return result;
  }

  /** Recalcula o status do corte a partir dos clip_posts. */
  private async recomputeClipStatus(orgId: string, clipId: string): Promise<void> {
    const { data } = await this.supabase.adminClient
      .from('clip_posts')
      .select('status')
      .eq('clip_id', clipId)
      .eq('org_id', orgId);
    const statuses = (data ?? []).map((r: { status: string }) => r.status);
    if (statuses.length === 0) return;
    let next: string | null = null;
    if (statuses.every((s) => s === 'publicado')) next = 'publicado';
    else if (statuses.every((s) => s === 'falhou')) next = 'falhou';
    if (next) {
      await this.supabase.adminClient
        .from('clips')
        .update({ status: next })
        .eq('id', clipId)
        .eq('org_id', orgId);
    }
  }

  private isDue(clip: Clip, post: ClipPost): boolean {
    const now = Date.now();
    const scheduled = post.scheduled_at ? new Date(post.scheduled_at).getTime() : null;
    if (clip.status === 'agendado') return scheduled !== null && scheduled <= now;
    // aprovado: publica já, a menos que tenha agendamento futuro no post
    return scheduled === null || scheduled <= now;
  }

  private async resolveVideoUrl(orgId: string, clip: Clip): Promise<string | null> {
    if (clip.file_url) return clip.file_url;
    if (clip.drive_file_id) {
      try {
        return await this.drive.makeSourceUrl(orgId, clip.drive_file_id);
      } catch {
        return null;
      }
    }
    return null;
  }

  private async resolveBrandId(orgId: string): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('social_brands')
      .select('id')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  }

  // ── Alerta de falha (WhatsApp pros gestores) ──────────────

  private async alertFailure(
    orgId: string,
    clip: Clip,
    platform: string,
    error: string,
  ): Promise<void> {
    const text =
      `*⚠️ Studio de Cortes — falha ao publicar*\n\n` +
      `Corte: ${clip.title || clip.hook || clip.id}\n` +
      `Plataforma: ${platform}\n` +
      `Erro: ${error.slice(0, 200)}`;
    try {
      const mgrs = (await this.managers.listActive(orgId)) as ManagerForAlert[];
      for (const m of mgrs) {
        try {
          await this.sendWhatsApp(orgId, m, text);
        } catch {
          /* best-effort */
        }
      }
    } catch {
      /* best-effort */
    }
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

// ── Helpers de copy ─────────────────────────────────────────

function buildCaption(copy: string | null, hashtags: string[]): string {
  const tags = (hashtags ?? []).map((h) => `#${h.replace(/^#/, '')}`).join(' ');
  return [copy?.trim(), tags].filter(Boolean).join('\n\n').slice(0, 2200);
}

function buildYouTubeDescription(copy: string | null, hashtags: string[]): string {
  const tags = (hashtags ?? []).map((h) => `#${h.replace(/^#/, '')}`);
  if (!tags.some((t) => /^#shorts$/i.test(t))) tags.push('#Shorts');
  return [copy?.trim(), tags.join(' ')].filter(Boolean).join('\n\n').slice(0, 5000);
}
