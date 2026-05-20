'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

type DealRisk = 'low' | 'medium' | 'high' | 'critical';

interface RiskPillProps {
  risk: DealRisk | null;
  className?: string;
}

const STYLES: Record<DealRisk, { bg: string; text: string }> = {
  low: { bg: 'bg-accent/15', text: 'text-accent' },
  medium: { bg: 'bg-yellow-500/15', text: 'text-yellow-500' },
  high: { bg: 'bg-orange-500/15', text: 'text-orange-500' },
  critical: { bg: 'bg-red-500/15', text: 'text-red-500' },
};

export function RiskPill({ risk, className }: RiskPillProps) {
  const t = useTranslations('funis.deal.risk');
  if (!risk) return null;
  const s = STYLES[risk];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        s.bg,
        s.text,
        className,
      )}
    >
      {t(risk)}
    </span>
  );
}
