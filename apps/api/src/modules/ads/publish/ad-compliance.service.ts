import { Injectable } from '@nestjs/common';
import {
  AD_SPECS,
  POLICY_PATTERNS,
  TEXT_LIMITS,
  type AdCreativeFormat,
} from './meta-ad-specs';
import type { AdComposition, AdCopy } from './ad-compositions.types';

export interface ComplianceIssue {
  code: string;
  severity: 'hard' | 'soft';
  message: string;
  field?: string;
}

export interface ComplianceResult {
  ok: boolean; // sem issues HARD
  hard: ComplianceIssue[];
  soft: ComplianceIssue[];
}

/** Metadados de mídia conhecidos (vêm do social_content quando reusamos). */
export interface MediaInfo {
  url?: string;
  content_type?: string;
  bytes?: number;
  width?: number;
  height?: number;
  duration_sec?: number;
}

/**
 * AdComplianceService — porteiro anti-reprovação.
 *
 * Roda ANTES de publicar no Meta. Aplica as specs/limites de meta-ad-specs:
 *   - texto (comprimento → trunca = SOFT);
 *   - política (atributos pessoais = HARD; claims/CAPS = SOFT);
 *   - mídia, quando dimensões/tipo/bytes/duração são conhecidos
 *     (proporção/resolução/tamanho/duração/cards).
 *
 * HARD bloqueia o publish; SOFT só avisa (Meta normalmente trunca/penaliza,
 * não recusa). Determinístico e sem custo — a prevenção principal é o prompt
 * de geração, que já nasce dentro da régua.
 */
@Injectable()
export class AdComplianceService {
  /** Valida a composição inteira. format/media default = image sem metadados. */
  check(
    comp: AdComposition,
    opts: { format?: AdCreativeFormat; media?: MediaInfo[] } = {},
  ): ComplianceResult {
    const format: AdCreativeFormat = opts.format ?? 'image';
    const issues: ComplianceIssue[] = [];

    issues.push(...this.checkCopies(comp.ad_copies ?? []));
    issues.push(...this.checkCreativePresence(format, comp, opts.media));
    if (opts.media?.length) issues.push(...this.checkMedia(format, opts.media));

    const hard = issues.filter((i) => i.severity === 'hard');
    const soft = issues.filter((i) => i.severity === 'soft');
    return { ok: hard.length === 0, hard, soft };
  }

  // ── Texto + política ─────────────────────────────────────────

  private checkCopies(copies: AdCopy[]): ComplianceIssue[] {
    const out: ComplianceIssue[] = [];
    copies.forEach((c, idx) => {
      const tag = `var ${c.variant ?? idx + 1}`;
      // comprimento (trunca → soft)
      if ((c.headline ?? '').length > TEXT_LIMITS.headline.hard) {
        out.push({ code: 'headline_too_long', severity: 'soft', field: tag, message: `${tag}: título com ${c.headline.length} chars (Meta corta em ${TEXT_LIMITS.headline.hard}).` });
      }
      if ((c.primary_text ?? '').length > TEXT_LIMITS.primary_text.recommended) {
        out.push({ code: 'primary_text_long', severity: 'soft', field: tag, message: `${tag}: texto principal passa de ${TEXT_LIMITS.primary_text.recommended} chars — trunca no "ver mais".` });
      }
      if ((c.description ?? '').length > TEXT_LIMITS.description.hard) {
        out.push({ code: 'description_too_long', severity: 'soft', field: tag, message: `${tag}: descrição com ${c.description!.length} chars (corta em ${TEXT_LIMITS.description.hard}).` });
      }
      // política
      const text = [c.primary_text, c.headline, c.description].filter(Boolean).join(' \n ');
      for (const p of POLICY_PATTERNS) {
        if (p.re.test(text)) {
          out.push({ code: p.id, severity: p.severity, field: tag, message: `${tag}: ${p.hint}` });
        }
      }
    });
    return out;
  }

  // ── Presença de criativo por formato ─────────────────────────

  private checkCreativePresence(
    format: AdCreativeFormat,
    comp: AdComposition,
    media?: MediaInfo[],
  ): ComplianceIssue[] {
    const out: ComplianceIssue[] = [];
    if (format === 'image') {
      const hasImg = (comp.ad_copies ?? []).every((c) => c.image_url || c.image_hash);
      if (!hasImg) {
        out.push({ code: 'image_missing', severity: 'hard', message: 'Anúncio de imagem precisa de uma imagem em cada variante.' });
      }
    }
    if (format === 'carousel') {
      const cards = AD_SPECS.carousel.cards!;
      const n = media?.length ?? 0;
      if (n < cards.min || n > cards.max) {
        out.push({ code: 'carousel_cards', severity: 'hard', message: `Carrossel precisa de ${cards.min} a ${cards.max} cards (tem ${n}).` });
      }
    }
    if ((format === 'video' || format === 'reels') && !(media && media.length)) {
      out.push({ code: 'video_missing', severity: 'hard', message: 'Anúncio de vídeo/Reels precisa de um vídeo.' });
    }
    return out;
  }

  // ── Mídia (quando metadados conhecidos) ──────────────────────

  private checkMedia(format: AdCreativeFormat, media: MediaInfo[]): ComplianceIssue[] {
    const spec = AD_SPECS[format];
    const out: ComplianceIssue[] = [];
    media.forEach((m, i) => {
      const tag = media.length > 1 ? `card ${i + 1}` : 'mídia';
      const isVideo = (m.content_type ?? '').startsWith('video') || format === 'video' || format === 'reels';

      // tipo
      const allowed = isVideo ? spec.videoTypes : spec.imageTypes;
      if (m.content_type && allowed.length && !allowed.includes(m.content_type)) {
        out.push({ code: 'media_type', severity: 'hard', field: tag, message: `${tag}: formato ${m.content_type} não aceito (use ${allowed.join('/')}).` });
      }
      // tamanho
      const maxBytes = isVideo ? spec.maxVideoBytes : spec.maxImageBytes;
      if (m.bytes && maxBytes && m.bytes > maxBytes) {
        out.push({ code: 'media_bytes', severity: 'hard', field: tag, message: `${tag}: arquivo ${(m.bytes / 1024 / 1024).toFixed(0)}MB excede o limite ${(maxBytes / 1024 / 1024).toFixed(0)}MB.` });
      }
      // resolução mínima
      if (m.width && m.height && (m.width < spec.minWidth || m.height < spec.minHeight)) {
        out.push({ code: 'media_resolution', severity: 'hard', field: tag, message: `${tag}: resolução ${m.width}×${m.height} abaixo do mínimo ${spec.minWidth}×${spec.minHeight}.` });
      }
      // proporção
      if (m.width && m.height) {
        const ar = m.width / m.height;
        const tol = spec.aspectTolerance;
        const within = ar >= spec.aspect.min * (1 - tol) && ar <= spec.aspect.max * (1 + tol);
        if (!within) {
          out.push({ code: 'media_aspect', severity: 'soft', field: tag, message: `${tag}: proporção ${ar.toFixed(2)} fora do recomendado p/ ${format} (${spec.aspect.min.toFixed(2)}–${spec.aspect.max.toFixed(2)}).` });
        }
      }
      // duração (vídeo/reels)
      if (spec.duration && m.duration_sec) {
        if (m.duration_sec > spec.duration.hardMax) {
          out.push({ code: 'media_duration', severity: 'hard', field: tag, message: `${tag}: ${m.duration_sec}s excede o máximo ${spec.duration.hardMax}s p/ ${format}.` });
        } else if (m.duration_sec > spec.duration.recommendedMax) {
          out.push({ code: 'media_duration_long', severity: 'soft', field: tag, message: `${tag}: ${m.duration_sec}s — ideal ≤${spec.duration.recommendedMax}s p/ ${format}.` });
        }
      }
      // carrossel: cards com proporções diferentes
      if (format === 'carousel' && i > 0) {
        const first = media[0];
        if (first?.width && first.height && m.width && m.height) {
          const a0 = first.width / first.height;
          const a = m.width / m.height;
          if (Math.abs(a0 - a) > 0.02) {
            out.push({ code: 'carousel_aspect_mismatch', severity: 'soft', field: tag, message: `${tag}: proporção diferente do card 1 — todos os cards devem ter a mesma proporção.` });
          }
        }
      }
    });
    return out;
  }
}
