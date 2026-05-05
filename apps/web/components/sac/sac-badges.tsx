'use client';

import { cn } from '@/lib/utils';
import type {
  SacCategory,
  SacPriority,
  SacStatus,
  SacReputationRisk,
} from '@/lib/api/sac';

const PRIORITY_LABEL: Record<SacPriority, string> = {
  low: 'Baixo',
  normal: 'Normal',
  high: 'Alto',
  critical: 'Crítico',
  reputation_risk: 'Risco rep.',
};

const PRIORITY_COLOR: Record<SacPriority, string> = {
  low: 'border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300',
  normal: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  high: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  critical: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
  reputation_risk: 'border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-300 animate-pulse',
};

const STATUS_LABEL: Record<SacStatus, string> = {
  new: 'Novo',
  in_progress: 'Em andamento',
  waiting_customer: 'Aguardando cliente',
  waiting_internal: 'Aguardando interno',
  resolved: 'Resolvido',
  reopened: 'Reaberto',
  cancelled: 'Cancelado',
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

const CATEGORY_LABEL: Record<SacCategory, string> = {
  pre_sale: 'Pré-venda',
  post_sale: 'Pós-venda',
  order_status: 'Status do pedido',
  delivery_delay: 'Atraso',
  exchange: 'Troca',
  return: 'Devolução',
  warranty: 'Garantia',
  cancellation: 'Cancelamento',
  refund: 'Reembolso',
  defective_product: 'Defeito',
  wrong_product: 'Produto errado',
  missing_parts: 'Falta de peças',
  invoice: 'Nota fiscal',
  payment: 'Pagamento',
  technical: 'Técnico',
  complaint: 'Reclamação',
  mediation: 'Mediação',
  negative_review: 'Avaliação negativa',
  general: 'Geral',
};

const RISK_LABEL: Record<SacReputationRisk, string> = {
  none: '—',
  low: 'Baixo',
  medium: 'Médio',
  high: 'Alto',
  critical: 'Crítico',
};

const RISK_COLOR: Record<SacReputationRisk, string> = {
  none: 'border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300',
  low: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
  medium: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  high: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  critical: 'border-red-500/50 bg-red-500/20 text-red-700 dark:text-red-300 animate-pulse',
};

export function PriorityBadge({ priority, className }: { priority: SacPriority; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        PRIORITY_COLOR[priority],
        className,
      )}
    >
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: SacStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        STATUS_COLOR[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function CategoryBadge({ category, className }: { category: SacCategory; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground',
        className,
      )}
    >
      {CATEGORY_LABEL[category]}
    </span>
  );
}

export function ReputationRiskBadge({ level, className }: { level: SacReputationRisk; className?: string }) {
  if (level === 'none') return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        RISK_COLOR[level],
        className,
      )}
    >
      Risco {RISK_LABEL[level]}
    </span>
  );
}

export const sacLabels = {
  priority: PRIORITY_LABEL,
  status: STATUS_LABEL,
  category: CATEGORY_LABEL,
  risk: RISK_LABEL,
};
