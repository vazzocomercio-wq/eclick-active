import { cn } from '@/lib/utils';

type DealRisk = 'low' | 'medium' | 'high' | 'critical';

interface RiskPillProps {
  risk: DealRisk | null;
  className?: string;
}

const STYLES: Record<DealRisk, { bg: string; text: string; label: string }> = {
  low: { bg: 'bg-accent/15', text: 'text-accent', label: 'Baixo' },
  medium: { bg: 'bg-yellow-500/15', text: 'text-yellow-500', label: 'Médio' },
  high: { bg: 'bg-orange-500/15', text: 'text-orange-500', label: 'Alto' },
  critical: { bg: 'bg-red-500/15', text: 'text-red-500', label: 'Crítico' },
};

export function RiskPill({ risk, className }: RiskPillProps) {
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
      {s.label}
    </span>
  );
}
