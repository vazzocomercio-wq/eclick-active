'use client';

import Link from 'next/link';
import { Calendar, Image as ImageIcon } from 'lucide-react';
import type { SocialContent } from '@/lib/api/social';
import { StatusBadge, PillarBadge, TypeBadge } from './social-badges';
import { cn } from '@/lib/utils';

interface ContentCardProps {
  content: SocialContent;
  className?: string;
  compact?: boolean;
}

export function ContentCard({ content, className, compact }: ContentCardProps) {
  const cover = content.cover_image_url ?? content.media[0]?.url ?? null;
  const titleText = content.title ?? content.caption?.slice(0, 60) ?? 'Sem título';
  const scheduled = content.scheduled_for
    ? new Date(content.scheduled_for).toLocaleString('pt-BR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <Link
      href={`/social/conteudo/${content.id}`}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/40',
        className,
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {cover ? (
          cover.endsWith('.svg') || cover.includes('image/svg') ? (
            <object
              data={cover}
              type="image/svg+xml"
              className="absolute inset-0 h-full w-full"
              aria-label="Preview"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-40" />
          </div>
        )}
        <div className="absolute left-2 top-2">
          <TypeBadge type={content.content_type} />
        </div>
      </div>
      <div className={cn('flex flex-col gap-1.5 p-2', compact && 'p-1.5')}>
        <p
          className={cn(
            'line-clamp-2 font-medium leading-tight',
            compact ? 'text-xs' : 'text-sm',
          )}
        >
          {titleText}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge status={content.status} />
          {content.pillar && <PillarBadge pillar={content.pillar} />}
        </div>
        {scheduled && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {scheduled}
          </span>
        )}
      </div>
    </Link>
  );
}
