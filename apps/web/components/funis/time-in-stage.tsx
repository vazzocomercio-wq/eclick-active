import { AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimeInStageProps {
  hours: number;
  slaBreached: boolean;
  className?: string;
}

export function TimeInStage({ hours, slaBreached, className }: TimeInStageProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium',
        slaBreached ? 'text-red-500' : 'text-muted-foreground',
        className,
      )}
      title={slaBreached ? 'SLA estourado' : 'Tempo na etapa'}
    >
      {slaBreached ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      {formatHours(hours)}
    </span>
  );
}

export function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '—';
  const totalMin = Math.floor(hours * 60);
  const days = Math.floor(totalMin / (60 * 24));
  const hrs = Math.floor((totalMin % (60 * 24)) / 60);
  const min = totalMin % 60;
  if (days > 0) return hrs > 0 ? `${days}d ${hrs}h` : `${days}d`;
  if (hrs > 0) return min > 0 ? `${hrs}h ${min}m` : `${hrs}h`;
  return `${min}m`;
}
