'use client';

import { CHANNEL_COLOR, CHANNEL_LABEL, type ContentChannel } from '@/lib/api/content-calendar';
import { cn } from '@/lib/utils';

const ORDER: ContentChannel[] = [
  'instagram',
  'facebook',
  'tiktok',
  'whatsapp',
  'email',
  'meta_ads',
  'google_ads',
];

interface ChannelColorLegendProps {
  className?: string;
  selected?: ContentChannel[];
  onToggle?: (channel: ContentChannel) => void;
}

/**
 * Legenda de cores dos canais. Quando `selected` + `onToggle` vêm,
 * vira filtro multi-select (canais não selecionados ficam dimmed).
 */
export function ChannelColorLegend({
  className,
  selected,
  onToggle,
}: ChannelColorLegendProps) {
  const isFilter = !!selected && !!onToggle;
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {ORDER.map((channel) => {
        const color = CHANNEL_COLOR[channel];
        const active = !isFilter || selected.includes(channel);
        return (
          <button
            key={channel}
            type="button"
            onClick={isFilter ? () => onToggle(channel) : undefined}
            disabled={!isFilter}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-opacity',
              isFilter && 'cursor-pointer hover:opacity-100',
              !active && 'opacity-40',
              isFilter && 'min-h-[36px]', // touch-target compat
            )}
            style={{
              borderColor: `${color}66`,
              backgroundColor: `${color}1a`,
              color,
            }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            {CHANNEL_LABEL[channel]}
          </button>
        );
      })}
    </div>
  );
}
