'use client';

import { useMemo, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PromptSuggestion {
  /** Texto que vai pro input quando clicado */
  text: string;
  /** Texto curto exibido no chip (default = `text` truncado) */
  label?: string;
  icon?: LucideIcon;
  /** Cor de accent — default cyan brand. Pode ser hex ou variável tailwind. */
  accent?: string;
}

interface AnimatedPromptSuggestionsProps {
  /** Sugestões fluindo no fundo. Ideal ≥9 (3 por row × 3 rows). */
  suggestions: PromptSuggestion[];
  /** Conteúdo principal (input/textarea + ações) — fica em destaque embaixo. */
  children: ReactNode;
  /** Callback quando user clica num chip — geralmente preenche o input. */
  onSuggestionClick?: (text: string) => void;
  /** Velocidade marquee em segundos. Default 50 (mais alto = mais lento). */
  speed?: number;
  /** Quantas rows visíveis. Default 3. Use 1 em popovers/drawers estreitos. */
  rows?: 1 | 2 | 3;
  /** Modo compacto: chips menores, padding reduzido. Pra drawers/dialogs. */
  compact?: boolean;
  className?: string;
}

/**
 * Header animado com 3 rows de chips de prompts fluindo horizontalmente
 * em direções alternadas. Hover no carrossel pausa todas as animações.
 * Clicar num chip preenche o input via callback.
 *
 * Visual: dark glass + soft glow ao redor do input + chips translúcidos
 * com hover state cyan brand.
 *
 * Uso típico: copiloto/chat IA quando user vai fazer pergunta — sugestões
 * "What's the status…", "Why is it failing…" etc dão sensação de IA viva
 * + ajudam usuário a iniciar prompts úteis.
 */
export function AnimatedPromptSuggestions({
  suggestions,
  children,
  onSuggestionClick,
  speed = 50,
  rows: rowCount = 3,
  compact = false,
  className,
}: AnimatedPromptSuggestionsProps) {
  // Distribui em N rows alternando — items[i] vai pro row i%N.
  // Resulta em rows balanceadas mesmo quando suggestions.length não é múltiplo de N.
  const rows = useMemo(() => {
    const r: PromptSuggestion[][] = Array.from({ length: rowCount }, () => []);
    suggestions.forEach((s, i) => {
      r[i % rowCount]!.push(s);
    });
    return r;
  }, [suggestions, rowCount]);

  return (
    <div className={cn('group/aps relative flex flex-col', compact ? 'gap-2' : 'gap-3', className)}>
      {/* Carrossel — pause-on-hover global via group/aps */}
      <div className={cn('flex flex-col overflow-hidden', compact ? 'gap-1 py-0.5' : 'gap-2 py-1')}>
        {rows.map((row, i) => (
          <MarqueeRow
            key={i}
            items={row}
            direction={i % 2 === 0 ? 'left' : 'right'}
            speed={speed + i * 5}
            onClick={onSuggestionClick}
            compact={compact}
          />
        ))}
      </div>

      {/* Input em destaque */}
      <div className="relative">{children}</div>
    </div>
  );
}

function MarqueeRow({
  items,
  direction,
  speed,
  onClick,
  compact,
}: {
  items: PromptSuggestion[];
  direction: 'left' | 'right';
  speed: number;
  onClick?: (text: string) => void;
  compact: boolean;
}) {
  if (items.length === 0) return null;

  // Duplica itens pra loop sem corte. translateX(-50%) move a 1ª metade
  // pra fora da view enquanto 2ª metade entra — visualmente seamless.
  const doubled = [...items, ...items];

  return (
    <div className="flex overflow-hidden">
      <div
        className={cn(
          'flex shrink-0 pr-2',
          compact ? 'gap-1.5' : 'gap-2',
          // Animação keyframes definida em globals.css
          direction === 'left' ? 'animate-marquee-left' : 'animate-marquee-right',
          // Pause global quando user hover qualquer chip ou área do componente
          'group-hover/aps:[animation-play-state:paused]',
        )}
        style={{ animationDuration: `${speed}s` }}
      >
        {doubled.map((item, i) => (
          <Chip key={i} item={item} onClick={onClick} compact={compact} />
        ))}
      </div>
    </div>
  );
}

function Chip({
  item,
  onClick,
  compact,
}: {
  item: PromptSuggestion;
  onClick?: (text: string) => void;
  compact: boolean;
}) {
  // Defensive: caller passou undefined no array? Skip esse chip silenciosamente.
  if (!item) return null;
  const Icon = item.icon;
  const accent = item.accent ?? '#00E5FF';
  const label = item.label ?? item.text;
  return (
    <button
      type="button"
      onClick={() => onClick?.(item.text)}
      className={cn(
        'group/chip flex shrink-0 items-center rounded-full border border-border/50 bg-card/40',
        compact ? 'gap-1 px-2 py-0.5 text-[10px]' : 'gap-1.5 px-3 py-1.5 text-xs',
        'whitespace-nowrap text-muted-foreground/70 backdrop-blur-sm',
        'transition-all duration-200',
        'hover:border-primary/60 hover:bg-card hover:text-foreground hover:shadow-md',
        'focus:outline-none focus:ring-2 focus:ring-primary/40',
      )}
      style={{ '--accent': accent } as React.CSSProperties}
    >
      {Icon && (
        <Icon
          className={cn(
            'shrink-0 opacity-60 transition-all group-hover/chip:opacity-100',
            compact ? 'h-2.5 w-2.5' : 'h-3 w-3',
          )}
          style={{ color: accent }}
        />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}
