import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  ImageGenerationService,
  SIGNED_URL_REFRESH_THRESHOLD_MS,
} from './image-generation.service';
import type {
  SocialContentMedia,
  SocialContentSlide,
} from '../social.types';

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const STARTUP_DELAY_MS = 4 * 60 * 1000; // 4min — depois dos outros workers
const PAGE_SIZE = 500;

/**
 * Worker de manutenção das signed URLs do bucket social-media.
 *
 * As imagens geradas ficam num bucket privado e são referenciadas por
 * signed URLs com TTL de 30 dias. Sem renovação, toda a biblioteca de
 * conteúdo viraria link quebrado com o tempo. Este worker varre
 * social_contents e social_assets 1× ao dia e re-assina qualquer URL a
 * menos de 7 dias do vencimento (ou já vencida — o caminho do arquivo
 * fica embutido na URL, então rows legadas sem storage_path também são
 * recuperáveis).
 *
 * Cross-org por design (manutenção de plataforma); cada UPDATE é
 * escopado por id + org_id da própria row.
 *
 * Disable via SOCIAL_MEDIA_REFRESH_DISABLED=true.
 */
@Injectable()
export class MediaRefreshWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly log = new Logger(MediaRefreshWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly images: ImageGenerationService,
  ) {}

  onModuleInit(): void {
    if (process.env.SOCIAL_MEDIA_REFRESH_DISABLED === 'true') {
      this.log.warn('SOCIAL_MEDIA_REFRESH_DISABLED=true — worker desligado');
      return;
    }
    this.startupTimeout = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
    this.log.log('MediaRefreshWorker armado — tick a cada 24h');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
  }

  async tick(): Promise<{ contents: number; assets: number }> {
    if (this.running) return { contents: 0, assets: 0 };
    this.running = true;
    try {
      const contents = await this.refreshContents();
      const assets = await this.refreshAssets();
      if (contents || assets) {
        this.log.log(
          `tick: ${contents} contents e ${assets} assets com URLs renovadas`,
        );
      }
      return { contents, assets };
    } catch (err) {
      this.log.warn(`tick falhou: ${String(err)}`);
      return { contents: 0, assets: 0 };
    } finally {
      this.running = false;
    }
  }

  private async refreshContents(): Promise<number> {
    let updated = 0;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: rows, error } = await this.supabase.adminClient
        .from('social_contents')
        .select('id, org_id, cover_image_url, media, slides')
        .order('id')
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        this.log.warn(`page de social_contents falhou: ${error.message}`);
        break;
      }
      if (!rows?.length) break;

      for (const row of rows) {
        try {
          const patch = await this.buildContentPatch(row);
          if (!patch) continue;
          const { error: upErr } = await this.supabase.adminClient
            .from('social_contents')
            .update(patch)
            .eq('id', row.id)
            .eq('org_id', row.org_id);
          if (upErr) {
            this.log.warn(`update content ${row.id} falhou: ${upErr.message}`);
          } else {
            updated++;
          }
        } catch (err) {
          this.log.warn(`content ${row.id} falhou: ${String(err)}`);
        }
      }
      if (rows.length < PAGE_SIZE) break;
    }
    return updated;
  }

  /** Monta o patch com as URLs renovadas, ou null se nada venceu. */
  private async buildContentPatch(row: {
    cover_image_url: string | null;
    media: SocialContentMedia[] | null;
    slides: SocialContentSlide[] | null;
  }): Promise<Record<string, unknown> | null> {
    const patch: Record<string, unknown> = {};
    // Mapa URL antiga → nova, pra manter cover/media/slides em sincronia
    // (a mesma imagem aparece nos três lugares)
    const renewed = new Map<string, string>();

    const refresh = async (
      url: string | null | undefined,
      persistedPath?: string | null,
    ): Promise<string | null> => {
      if (!url) return null;
      if (renewed.has(url)) return renewed.get(url) ?? null;
      const fresh = await this.images.refreshUrlIfExpiring(
        url,
        SIGNED_URL_REFRESH_THRESHOLD_MS,
        persistedPath,
      );
      if (fresh) renewed.set(url, fresh);
      return fresh;
    };

    if (Array.isArray(row.media) && row.media.length) {
      let changed = false;
      const media = [];
      for (const m of row.media) {
        const fresh = await refresh(m.url, m.storage_path);
        const freshThumb = await refresh(m.thumbnail_url);
        if (fresh || freshThumb) changed = true;
        media.push({
          ...m,
          url: fresh ?? m.url,
          ...(m.thumbnail_url
            ? { thumbnail_url: freshThumb ?? m.thumbnail_url }
            : {}),
        });
      }
      if (changed) patch.media = media;
    }

    if (Array.isArray(row.slides) && row.slides.length) {
      let changed = false;
      const slides = [];
      for (const s of row.slides) {
        const fresh = await refresh(s.image_url);
        if (fresh) changed = true;
        slides.push({ ...s, image_url: fresh ?? s.image_url });
      }
      if (changed) patch.slides = slides;
    }

    const freshCover = await refresh(row.cover_image_url);
    if (freshCover) patch.cover_image_url = freshCover;

    return Object.keys(patch).length ? patch : null;
  }

  private async refreshAssets(): Promise<number> {
    let updated = 0;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: rows, error } = await this.supabase.adminClient
        .from('social_assets')
        .select('id, org_id, url, thumbnail_url, metadata')
        .order('id')
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        this.log.warn(`page de social_assets falhou: ${error.message}`);
        break;
      }
      if (!rows?.length) break;

      for (const row of rows) {
        try {
          const meta = (row.metadata ?? {}) as { storage_path?: string };
          const patch: Record<string, unknown> = {};
          const fresh = await this.images.refreshUrlIfExpiring(
            row.url,
            SIGNED_URL_REFRESH_THRESHOLD_MS,
            meta.storage_path,
          );
          if (fresh) patch.url = fresh;
          const freshThumb = await this.images.refreshUrlIfExpiring(
            row.thumbnail_url,
          );
          if (freshThumb) patch.thumbnail_url = freshThumb;
          if (!Object.keys(patch).length) continue;

          const { error: upErr } = await this.supabase.adminClient
            .from('social_assets')
            .update(patch)
            .eq('id', row.id)
            .eq('org_id', row.org_id);
          if (upErr) {
            this.log.warn(`update asset ${row.id} falhou: ${upErr.message}`);
          } else {
            updated++;
          }
        } catch (err) {
          this.log.warn(`asset ${row.id} falhou: ${String(err)}`);
        }
      }
      if (rows.length < PAGE_SIZE) break;
    }
    return updated;
  }
}
