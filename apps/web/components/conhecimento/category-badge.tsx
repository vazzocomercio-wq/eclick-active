import type { KnowledgeCategory } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

const CATEGORY_STYLES: Record<KnowledgeCategory, { bg: string; text: string; label: string }> = {
  general: { bg: 'bg-slate-500/15', text: 'text-slate-400', label: 'Geral' },
  products: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Produtos' },
  pricing: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Preços' },
  policies: { bg: 'bg-purple-500/15', text: 'text-purple-400', label: 'Políticas' },
  faq: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', label: 'FAQ' },
  scripts: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Scripts' },
  objections: { bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'Objeções' },
  procedures: { bg: 'bg-pink-500/15', text: 'text-pink-400', label: 'Procedimentos' },
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
      {s.label}
    </span>
  );
}

export function categoryLabel(c: KnowledgeCategory): string {
  return CATEGORY_STYLES[c].label;
}
