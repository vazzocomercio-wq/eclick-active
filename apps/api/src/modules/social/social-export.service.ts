import { Injectable, Logger } from '@nestjs/common';
import { SocialContentsService } from './social-contents.service';

export interface ExportPackage {
  filename: string;
  mime_type: string;
  /** Texto pronto pra colar no Instagram (caption + hashtags). */
  caption_block: string;
  /** Lista de URLs de imagens pra baixar manualmente. */
  image_urls: string[];
  /** Sugestão de horário formatada. */
  scheduled_for?: string;
  channels: string[];
}

/**
 * Export de conteúdo aprovado pra publicação manual.
 *
 * MVP 1: gera "package descriptor" — JSON com caption, hashtags formatadas
 * e URLs das imagens. UI faz download/copy. Geração de ZIP real fica pra
 * quando integrar publicação automática (MVP 2).
 *
 * Rationale: gerar ZIP no backend exige adicionar deps (jszip/archiver) e
 * lidar com streaming do Storage. No MVP, descritor JSON é suficiente —
 * UI pode listar imagens, copiar caption, e usuário publica manualmente.
 */
@Injectable()
export class SocialExportService {
  private readonly log = new Logger(SocialExportService.name);

  constructor(private readonly contents: SocialContentsService) {}

  async exportContent(orgId: string, contentId: string): Promise<ExportPackage> {
    const content = await this.contents.findById(orgId, contentId);

    const captionLines: string[] = [];
    if (content.caption) captionLines.push(content.caption);
    if (content.hashtags.length > 0) {
      captionLines.push('', content.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' '));
    }
    if (content.cta) captionLines.push('', `→ ${content.cta}`);

    const imageUrls: string[] = [];
    if (content.cover_image_url) imageUrls.push(content.cover_image_url);
    for (const m of content.media) {
      if (m.url && !imageUrls.includes(m.url)) imageUrls.push(m.url);
    }

    return {
      filename: `${content.title ?? content.id}-${content.id.slice(0, 8)}.json`,
      mime_type: 'application/json',
      caption_block: captionLines.join('\n'),
      image_urls: imageUrls,
      scheduled_for: content.scheduled_for ?? undefined,
      channels: content.channels,
    };
  }
}
