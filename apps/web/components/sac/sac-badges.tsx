'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type {
  SacCategory,
  SacPriority,
  SacStatus,
  SacReputationRisk,
} from '@/lib/api/sac';

const PRIORITY_COLOR: Record<SacPriority, string> = {
  low: 'border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300',
  normal: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  high: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  critical: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
  reputation_risk: 'border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-300 animate-pulse',
};

const STATUS_COLOR: Record<SacStatus, string> = {
  new: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  in_progress: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  waiting_customer: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  waiting_internal: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  resolved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  reopened: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  cancelled: 'border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300',
};

const RISK_COLOR: Record<SacReputationRisk, string> = {
  none: 'border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300',
  low: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
  medium: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  high: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  critical: 'border-red-500/50 bg-red-500/20 text-red-700 dark:text-red-300 animate-pulse',
};

export function PriorityBadge({ priority, className }: { priority: SacPriority; className?: string }) {
  const t = useTranslations('sac.badges.priority');
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        PRIORITY_COLOR[priority],
        className,
      )}
    >
      {t(priority)}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: SacStatus; className?: string }) {
  const t = useTranslations('sac.badges.status');
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        STATUS_COLOR[status],
        className,
      )}
    >
      {t(status)}
    </span>
  );
}

export function CategoryBadge({ category, className }: { category: SacCategory; className?: string }) {
  const t = useTranslations('sac.badges.category');
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground',
        className,
      )}
    >
      {t(category)}
    </span>
  );
}

export function ReputationRiskBadge({ level, className }: { level: SacReputationRisk; className?: string }) {
  const t = useTranslations('sac.badges');
  if (level === 'none') return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        RISK_COLOR[level],
        className,
      )}
    >
      {t('riskLabel', { level: t(`risk.${level}`) })}
    </span>
  );
}

/**
 * Helper to extract sac label keys for select inputs. Returns array of
 * [machineValue, machineValue] tuples — caller resolves labels via t().
 */
export const sacKeys = {
  priority: ['low', 'normal', 'high', 'critical', 'reputation_risk'] as SacPriority[],
  status: ['new', 'in_progress', 'waiting_customer', 'waiting_internal', 'resolved', 'reopened', 'cancelled'] as SacStatus[],
  category: [
    'pre_sale', 'post_sale', 'order_status', 'delivery_delay', 'exchange',
    'return', 'warranty', 'cancellation', 'refund', 'defective_product',
    'wrong_product', 'missing_parts', 'invoice', 'payment', 'technical',
    'complaint', 'mediation', 'negative_review', 'general',
  ] as SacCategory[],
};
