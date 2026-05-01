import { cn } from '@/lib/utils';

interface ProgressProps {
  value: number;
  max?: number;
  className?: string;
  /** Cor do fill — default usa --primary */
  fillClassName?: string;
}

export function Progress({ value, max = 100, className, fillClassName }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn('h-full rounded-full bg-primary transition-[width] duration-200', fillClassName)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
