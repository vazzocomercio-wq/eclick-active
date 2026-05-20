'use client';

import { useTranslations } from 'next-intl';
import type { KnowledgeCategory } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

const CATEGORY_STYLES: Record<KnowledgeCategory, { bg: string; text: string }> = {
  general: { bg: 'bg-slate-500/15', text: 'text-slate-400' },
  products: { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  pricing: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  policies: { bg: 'bg-purple-500/15', text: 'text-purple-400' },
  faq: { bg: 'bg-cyan-500/15', text: 'text-cyan-400' },
  scripts: { bg: 'bg-yellow-500/15', text: 'text-yellow-400' },
  objections: { bg: 'bg-orange-500/15', text: 'text-orange-400' },
  procedures: { bg: 'bg-pink-500/15', text: 'text-pink-400' },
};

export const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = [
  'general',
  'products',
  'pricing',
  'policies',
  'faq',
  'scripts',
  'objections',
  'procedures',
];

export function CategoryBadge({
  category,
  className,
}: {
  category: KnowledgeCategory;
  className?: string;
}) {
  const t = useTranslations('conhecimento.category');
  const s = CATEGORY_STYLES[category];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium',
        s.bg,
        s.text,
        className,
      )}
    >
      {t(category)}
    </span>
  );
}

export function useCategoryLabel(): (c: KnowledgeCategory) => string {
  const t = useTranslations('conhecimento.category');
  return (c: KnowledgeCategory) => t(c);
}

/** @deprecated Use `useCategoryLabel()` em client components. */
export function categoryLabel(c: KnowledgeCategory): string {
  const STATIC_PT: Record<KnowledgeCategory, string> = {
    general: 'Geral',
    products: 'Produtos',
    pricing: 'Preços',
    policies: 'Políticas',
    faq: 'FAQ',
    scripts: 'Scripts',
    objections: 'Objeções',
    procedures: 'Procedimentos',
  };
  return STATIC_PT[c];
}
