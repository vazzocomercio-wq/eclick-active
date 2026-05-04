import { cn } from '@/lib/utils';

interface TagPillsProps {
  tags: string[];
  /** Limita ao primeiro N e exibe "+X" caso ultrapasse. */
  max?: number;
  className?: string;
  /**
   * Tamanho da pílula. `xs` é o default (cards densos), `sm` pra contextos
   * com mais respiro (sheets, painéis).
   */
  size?: 'xs' | 'sm';
}

/**
 * Paleta curada pra tags livres. Cada tag recebe uma cor estável baseada
 * no hash do texto — mesma string sempre vira a mesma cor, e tags
 * diferentes lado a lado alternam visualmente. Compatível com tema dark
 * (`#09090B` background).
 *
 * Tailwind exige classes LITERAIS (não pode interpolar) — daí o mapping
 * explícito. Cada slot tem border 40%, bg 15%, text-color 300.
 */
const TAG_PALETTE: Array<{ border: string; bg: string; text: string }> = [
  { border: 'border-amber-500/40', bg: 'bg-amber-500/15', text: 'text-amber-300' },
  { border: 'border-emerald-500/40', bg: 'bg-emerald-500/15', text: 'text-emerald-300' },
  { border: 'border-sky-500/40', bg: 'bg-sky-500/15', text: 'text-sky-300' },
  { border: 'border-violet-500/40', bg: 'bg-violet-500/15', text: 'text-violet-300' },
  { border: 'border-rose-500/40', bg: 'bg-rose-500/15', text: 'text-rose-300' },
  { border: 'border-cyan-500/40', bg: 'bg-cyan-500/15', text: 'text-cyan-300' },
  { border: 'border-fuchsia-500/40', bg: 'bg-fuchsia-500/15', text: 'text-fuchsia-300' },
  { border: 'border-orange-500/40', bg: 'bg-orange-500/15', text: 'text-orange-300' },
];

/**
 * Retorna o slot de cores estável pra uma tag (mesma string = mesmo slot).
 * Hash simples por charcode sum — colisões aceitáveis (~12.5% por tag),
 * mas a mesma string SEMPRE retorna o mesmo slot.
 */
export function tagColor(tag: string): { border: string; bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash + tag.charCodeAt(i)) >>> 0;
  }
  return TAG_PALETTE[hash % TAG_PALETTE.length]!;
}

export function TagPills({ tags, max = 3, className, size = 'xs' }: TagPillsProps) {
  if (!tags || tags.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const visible = tags.slice(0, max);
  const remaining = tags.length - visible.length;

  const pillBase =
    size === 'sm'
      ? 'px-2.5 py-1 text-xs'
      : 'px-2 py-0.5 text-[11px]';

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {visible.map((tag) => {
        const c = tagColor(tag);
        return (
          <span
            key={tag}
            className={cn(
              'inline-flex items-center rounded-full border font-medium',
              pillBase,
              c.border,
              c.bg,
              c.text,
            )}
          >
            {tag}
          </span>
        );
      })}
      {remaining > 0 && (
        <span className="text-[11px] text-muted-foreground">+{remaining}</span>
      )}
    </div>
  );
}
