'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

interface AIScoreCircleProps {
  /** Score 0..100 */
  score: number;
  size?: number;
  className?: string;
}

/**
 * Círculo com score 0-100 e cor que varia:
 *  0-25: vermelho · 26-50: laranja · 51-75: amarelo · 76-100: verde
 */
export function AIScoreCircle({ score, size = 36, className }: AIScoreCircleProps) {
  const t = useTranslations('funis.deal');
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const stroke = scoreColorClass(clamped);
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
      aria-label={t('ariaScoreOf', { score: clamped })}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[-90deg]">
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          className="stroke-muted"
          strokeWidth={3}
          fill="none"
        />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          className={cn('transition-[stroke-dashoffset] duration-500 ease-out', stroke)}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums">
        {clamped}
      </span>
    </div>
  );
}

function scoreColorClass(score: number): string {
  if (score <= 25) return 'stroke-red-500';
  if (score <= 50) return 'stroke-orange-500';
  if (score <= 75) return 'stroke-yellow-500';
  return 'stroke-accent';
}
