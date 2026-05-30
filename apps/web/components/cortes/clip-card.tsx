'use client';

import { forwardRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Clock, Film, MessageSquareText, Sparkles } from 'lucide-react';
import type { ClipRow, ClipStatus } from '@/lib/api/studio-cortes';
import { cn } from '@/lib/utils';

interface ClipCardProps {
  clip: ClipRow;
  onSelect: () => void;
}

export function ClipCard({ clip, onSelect }: ClipCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: clip.id,
    data: { type: 'clip', status: clip.status },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <ClipCardVisual
      ref={setNodeRef}
      clip={clip}
      isDragging={isDragging}
      style={style}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    />
  );
}

interface ClipCardVisualProps extends React.HTMLAttributes<HTMLDivElement> {
  clip: ClipRow;
  isDragging?: boolean;
  isOverlay?: boolean;
}

export const ClipCardVisual = forwardRef<HTMLDivElement, ClipCardVisualProps>(
  ({ clip, isDragging, isOverlay, className, ...props }, ref) => {
    const vertical = clip.width === 1080 && clip.height === 1920;
    const postsWithCopy = clip.posts.filter((p) => (p.copy ?? '').trim() || (p.title ?? '').trim());

    return (
      <div
        ref={ref}
        className={cn(
          'group flex cursor-grab flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md',
          isDragging && 'opacity-30',
          isOverlay && 'rotate-1 cursor-grabbing border-primary/50 shadow-2xl',
          className,
        )}
        {...props}
      >
        {/* Prévia do corte (9:16, altura limitada) */}
        <div className="relative h-40 w-full bg-muted/40">
          {clip.file_url ? (
            <video
              src={clip.file_url}
              poster={clip.thumbnail_url ?? undefined}
              muted
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Film className="h-7 w-7" />
            </div>
          )}
          {/* Badges sobre a prévia */}
          <div className="absolute left-1.5 top-1.5 flex gap-1">
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums backdrop-blur',
                vertical
                  ? 'bg-emerald-500/85 text-white'
                  : 'bg-amber-500/85 text-white',
              )}
              title={vertical ? '1080×1920 (9:16)' : 'Verifique a proporção'}
            >
              {clip.width && clip.height ? `${clip.width}×${clip.height}` : '—'}
            </span>
          </div>
          {clip.duration_seconds != null && (
            <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
              <Clock className="h-2.5 w-2.5" />
              {formatDuration(clip.duration_seconds)}
            </span>
          )}
        </div>

        {/* Corpo */}
        <div className="flex flex-col gap-2 p-3">
          <h4 className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">
            {clip.title || clip.hook || 'Corte sem título'}
          </h4>

          {clip.hook && clip.title && (
            <p className="line-clamp-2 flex items-start gap-1 text-[11px] text-muted-foreground">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <span>{clip.hook}</span>
            </p>
          )}

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MessageSquareText className="h-3 w-3" />
              {postsWithCopy.length}/{clip.posts.length} copys
            </span>
            {clip.job?.title && (
              <span className="max-w-[55%] truncate" title={clip.job.title}>
                {clip.job.title}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  },
);
ClipCardVisual.displayName = 'ClipCardVisual';

function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export const STATUS_META: Record<
  ClipStatus,
  { label: string; rule: string; chip: string }
> = {
  a_revisar: {
    label: 'A revisar',
    rule: 'bg-amber-500',
    chip: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  },
  aprovado: {
    label: 'Aprovado',
    rule: 'bg-emerald-500',
    chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  },
  agendado: {
    label: 'Agendado',
    rule: 'bg-cyan-500',
    chip: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300',
  },
  publicado: {
    label: 'Publicado',
    rule: 'bg-emerald-600',
    chip: 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300',
  },
  falhou: {
    label: 'Falhou',
    rule: 'bg-red-500',
    chip: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300',
  },
};
