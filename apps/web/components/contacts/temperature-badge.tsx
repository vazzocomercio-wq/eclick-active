import type { ContactTemperature } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

interface TemperatureBadgeProps {
  temperature: ContactTemperature | null;
  className?: string;
}

const STYLES: Record<ContactTemperature, { bg: string; text: string; label: string }> = {
  cold: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Frio' },
  warm: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Morno' },
  hot: { bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'Quente' },
  very_hot: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Muito quente' },
};

export function TemperatureBadge({ temperature, className }: TemperatureBadgeProps) {
  if (!temperature) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground',
          className,
        )}
      >
        —
      </span>
    );
  }
  const style = STYLES[temperature];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        style.bg,
        style.text,
        className,
      )}
    >
      {style.label}
    </span>
  );
}

export { STYLES as TEMPERATURE_STYLES };
