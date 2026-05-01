import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface FactorBarProps {
  label: string;
  value: number;
  max?: number;
  className?: string;
}

export function FactorBar({ label, value, max = 25, className }: FactorBarProps) {
  const v = Math.max(0, Math.min(max, Math.round(value)));
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-medium text-foreground">
          {v}/{max}
        </span>
      </div>
      <Progress value={v} max={max} fillClassName="bg-primary" />
    </div>
  );
}
