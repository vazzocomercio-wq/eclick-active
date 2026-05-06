'use client';

import { useState } from 'react';
import { Heart, MessageCircle, Send, Bookmark, MoreHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';
import type { SocialContent, SocialBrand } from '@/lib/api/social';
import { cn } from '@/lib/utils';

interface InstagramMockupProps {
  content: SocialContent;
  brand?: SocialBrand | null;
  /** Quando true, mostra mockup completo (header+actions+caption). Default true. */
  showFrame?: boolean;
  className?: string;
}

/**
 * Preview fiel ao feed do Instagram. Suporta post estático (1 imagem) e
 * carrossel (slides com setas). Caption + hashtags renderizadas embaixo.
 *
 * Frame 1080×1080 (post quadrado). Caso de uso: tela de criação,
 * detalhe do conteúdo e modal de aprovação.
 */
export function InstagramMockup({
  content,
  brand,
  showFrame = true,
  className,
}: InstagramMockupProps) {
  const [slideIdx, setSlideIdx] = useState(0);

  const isCarousel = content.content_type === 'carousel' && content.slides.length > 0;
  const totalSlides = isCarousel ? content.slides.length : 1;

  const currentImage = isCarousel
    ? content.slides[slideIdx]?.image_url ?? null
    : content.cover_image_url ?? content.media[0]?.url ?? null;

  const captionPreview = (content.caption ?? '').split('\n');
  const firstLines = captionPreview.slice(0, 2).join('\n');
  const restLines = captionPreview.slice(2).join('\n');

  return (
    <div
      className={cn(
        'mx-auto max-w-md overflow-hidden rounded-xl border border-border bg-card',
        className,
      )}
    >
      {showFrame && (
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          {brand?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logo_url}
              alt={brand.name}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{
                background: `linear-gradient(135deg, ${brand?.primary_color ?? '#00E5FF'}, ${brand?.secondary_color ?? '#4ADE50'})`,
              }}
            >
              {(brand?.name ?? 'X').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="flex flex-1 flex-col leading-tight">
            <span className="text-xs font-semibold">
              {brand?.name ?? 'sua_marca'}
            </span>
            <span className="text-[10px] text-muted-foreground">Instagram</span>
          </div>
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </header>
      )}

      {/* Mídia */}
      <div className="relative aspect-square w-full bg-muted">
        {currentImage ? (
          // SVG vem inline; outros mostram via <img>
          currentImage.endsWith('.svg') || currentImage.includes('image/svg') ? (
            <object
              data={currentImage}
              type="image/svg+xml"
              className="absolute inset-0 h-full w-full"
              aria-label="Preview"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentImage}
              alt={content.title ?? ''}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="text-3xl">🖼️</span>
            <span>Sem imagem ainda</span>
          </div>
        )}

        {/* Indicadores de carrossel */}
        {isCarousel && totalSlides > 1 && (
          <>
            {slideIdx > 0 && (
              <button
                type="button"
                onClick={() => setSlideIdx((i) => i - 1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1 backdrop-blur"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {slideIdx < totalSlides - 1 && (
              <button
                type="button"
                onClick={() => setSlideIdx((i) => i + 1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1 backdrop-blur"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
              {Array.from({ length: totalSlides }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    i === slideIdx ? 'bg-white' : 'bg-white/40',
                  )}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {showFrame && (
        <>
          {/* Actions */}
          <div className="flex items-center gap-3 px-3 py-2">
            <Heart className="h-5 w-5" />
            <MessageCircle className="h-5 w-5" />
            <Send className="h-5 w-5" />
            <Bookmark className="ml-auto h-5 w-5" />
          </div>

          {/* Caption */}
          <div className="px-3 pb-3 text-sm">
            <p className="whitespace-pre-line">
              <span className="font-semibold">{brand?.name ?? 'sua_marca'}</span>{' '}
              {firstLines}
            </p>
            {restLines && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  ... ver mais
                </summary>
                <p className="mt-1 whitespace-pre-line">{restLines}</p>
              </details>
            )}
            {content.hashtags.length > 0 && (
              <p className="mt-2 text-xs text-blue-600 dark:text-blue-400">
                {content.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}
              </p>
            )}
            {content.cta && (
              <p className="mt-2 text-xs font-medium">→ {content.cta}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
