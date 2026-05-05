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
  className,
}: AnimatedPromptSuggestionsProps) {
  // Distribui em 3 rows alternando — items[i] vai pro row i%3.
  // Resulta em rows balanceadas mesmo quando suggestions.length não é múltiplo de 3.
  const rows = useMemo(() => {
    const r: PromptSuggestion[][] = [[], [], []];
    suggestions.forEach((s, i) => {
      r[i % 3]!.push(s);
    });
    return r;
  }, [suggestions]);

  return (
    <div className={cn('group/aps relative flex flex-col gap-3', className)}>
      {/* Carrossel — 3 rows com pause-on-hover global via group/aps */}
      <div className="flex flex-col gap-2 overflow-hidden py-1">
        {rows.map((row, i) => (
          <MarqueeRow
            key={i}
            items={row}
            direction={i % 2 === 0 ? 'left' : 'right'}
            speed={speed + i * 5}
            onClick={onSuggestionClick}
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
}: {
  items: PromptSuggestion[];
  direction: 'left' | 'right';
  speed: number;
  onClick?: (text: string) => void;
}) {
  if (items.length === 0) return null;

  // Duplica itens pra loop sem corte. translateX(-50%) move a 1ª metade
  // pra fora da view enquanto 2ª metade entra — visualmente seamless.
  const doubled = [...items, ...items];

  return (
    <div className="flex overflow-hidden">
      <div
        className={cn(
          'flex shrink-0 gap-2 pr-2',
          // Animação keyframes definida em globals.css
          direction === 'left' ? 'animate-marquee-left' : 'animate-marquee-right',
          // Pause global quando user hover qualquer chip ou área do componente
          'group-hover/aps:[animation-play-state:paused]',
        )}
        style={{ animationDuration: `${speed}s` }}
      >
        {doubled.map((item, i) => (
          <Chip key={i} item={item} onClick={onClick} />
        ))}
      </div>
    </div>
  );
}

function Chip({
  item,
  onClick,
}: {
  item: PromptSuggestion;
  onClick?: (text: string) => void;
}) {
  const Icon = item.icon;
  const accent = item.accent ?? '#00E5FF';
  const label = item.label ?? item.text;
  return (
    <button
      type="button"
      onClick={() => onClick?.(item.text)}
      className={cn(
        'group/chip flex shrink-0 items-center gap-1.5 rounded-full border border-border/50 bg-card/40 px-3 py-1.5 text-xs',
        'whitespace-nowrap text-muted-foreground/70 backdrop-blur-sm',
        'transition-all duration-200',
        'hover:border-primary/60 hover:bg-card hover:text-foreground hover:shadow-md',
        'focus:outline-none focus:ring-2 focus:ring-primary/40',
      )}
      style={
        {
          '--accent': accent,
        } as React.CSSProperties
      }
    >
      {Icon && (
        <Icon
          className="h-3 w-3 shrink-0 opacity-60 transition-all group-hover/chip:opacity-100"
          style={{ color: accent }}
        />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}
