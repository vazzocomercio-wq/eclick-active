import { cn } from '@/lib/utils';

interface ScoreBarProps {
  score: number;
  className?: string;
  /** Mostra o número ao lado da barra. Default: true. */
  showValue?: boolean;
}

/**
 * Score 0-100. Cor varia: <30 muted, 30-60 amber, 60-80 cyan (primary), 80+ green (accent).
 */
export function ScoreBar({ score, className, showValue = true }: ScoreBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));

  let fill: string;
  if (clamped < 30) fill = 'bg-muted-foreground/40';
  else if (clamped < 60) fill = 'bg-yellow-500/70';
  else if (clamped < 80) fill = 'bg-primary';
  else fill = 'bg-accent';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('h-full rounded-full transition-[width]', fill)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showValue && <span className="w-7 text-right text-xs tabular-nums text-muted-foreground">{clamped}</span>}
    </div>
  );
}
