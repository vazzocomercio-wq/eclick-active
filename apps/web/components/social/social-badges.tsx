'use client';

import { cn } from '@/lib/utils';
import type { ContentStatus, ContentPillar, ContentType } from '@/lib/api/social';

const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: 'Rascunho',
  generating: 'Gerando IA',
  pending_approval: 'Aguarda aprovação',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  scheduled: 'Agendado',
  published: 'Publicado',
  failed: 'Falhou',
};

const STATUS_COLOR: Record<ContentStatus, string> = {
  draft: 'border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300',
  generating: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 animate-pulse',
  pending_approval: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rejected: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  scheduled: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  published: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  failed: 'border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300',
};

const PILLAR_LABEL: Record<ContentPillar, string> = {
  educational: 'Educacional',
  promotional: 'Promocional',
  social_proof: 'Prova social',
  entertainment: 'Entretenimento',
  institutional: 'Institucional',
  engagement: 'Engajamento',
  product: 'Produto',
  behind_scenes: 'Bastidores',
};

const TYPE_LABEL: Record<ContentType, string> = {
  post: 'Post',
  carousel: 'Carrossel',
  reel: 'Reel',
  story: 'Story',
  tiktok: 'TikTok',
  vsl: 'VSL',
  ugc: 'UGC',
};

const TYPE_ICON: Record<ContentType, string> = {
  post: '📸',
  carousel: '🎴',
  reel: '🎬',
  story: '⚡',
  tiktok: '🎵',
  vsl: '📹',
  ugc: '👥',
};

export function StatusBadge({
  status,
  className,
}: {
  status: ContentStatus;
  className?: string;
}) {
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

export function PillarBadge({
  pillar,
  className,
}: {
  pillar: ContentPillar;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground',
        className,
      )}
    >
      {PILLAR_LABEL[pillar]}
    </span>
  );
}

export function TypeBadge({
  type,
  className,
}: {
  type: ContentType;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium',
        className,
      )}
    >
      <span>{TYPE_ICON[type]}</span>
      {TYPE_LABEL[type]}
    </span>
  );
}

export const socialLabels = {
  status: STATUS_LABEL,
  pillar: PILLAR_LABEL,
  type: TYPE_LABEL,
};
