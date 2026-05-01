import { cn } from '@/lib/utils';

interface TagPillsProps {
  tags: string[];
  /** Limita ao primeiro N e exibe "+X" caso ultrapasse. */
  max?: number;
  className?: string;
}

export function TagPills({ tags, max = 3, className }: TagPillsProps) {
  if (!tags || tags.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const visible = tags.slice(0, max);
  const remaining = tags.length - visible.length;

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {visible.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-foreground"
        >
          {tag}
        </span>
      ))}
      {remaining > 0 && (
        <span className="text-[11px] text-muted-foreground">+{remaining}</span>
      )}
    </div>
  );
}
