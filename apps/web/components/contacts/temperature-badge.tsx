'use client';

import { useTranslations } from 'next-intl';
import type { ContactTemperature } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

interface TemperatureBadgeProps {
  temperature: ContactTemperature | null;
  className?: string;
}

const STYLE_MAP: Record<ContactTemperature, { bg: string; text: string }> = {
  cold: { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  warm: { bg: 'bg-yellow-500/15', text: 'text-yellow-400' },
  hot: { bg: 'bg-orange-500/15', text: 'text-orange-400' },
  very_hot: { bg: 'bg-red-500/15', text: 'text-red-400' },
};

/**
 * Hook que retorna mapa de estilos + label traduzido por temperatura.
 * Use em components que precisam exibir o label fora do badge (ex: filtros).
 */
export function useTemperatureStyles(): Record<
  ContactTemperature,
  { bg: string; text: string; label: string }
> {
  const t = useTranslations('contacts.temperature');
  return {
    cold: { ...STYLE_MAP.cold, label: t('cold') },
    warm: { ...STYLE_MAP.warm, label: t('warm') },
    hot: { ...STYLE_MAP.hot, label: t('hot') },
    very_hot: { ...STYLE_MAP.very_hot, label: t('very_hot') },
  };
}

export function TemperatureBadge({ temperature, className }: TemperatureBadgeProps) {
  const t = useTranslations('contacts.temperature');
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
  const style = STYLE_MAP[temperature];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        style.bg,
        style.text,
        className,
      )}
    >
      {t(temperature)}
    </span>
  );
}
