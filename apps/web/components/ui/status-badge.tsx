import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatusBadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'brand';

interface StatusBadgeProps {
  /** Texto exibido na pílula. */
  children: ReactNode;
  /** Variante semântica — define cor border/bg/text. */
  variant?: StatusBadgeVariant;
  /** Ícone opcional à esquerda. */
  icon?: ReactNode;
  /**
   * Tamanho. `xs` é o default; `sm` tem mais respiro pra contextos amplos
   * (sheets, painéis, headers de seção).
   */
  size?: 'xs' | 'sm';
  className?: string;
}

const VARIANT_CLASSES: Record<StatusBadgeVariant, string> = {
  success: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  warning: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  danger: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
  info: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
  neutral: 'border-slate-500/40 bg-slate-500/15 text-slate-300',
  brand: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300',
};

/**
 * Pílula de status com cor SEMÂNTICA fixa + ícone opcional. Use pra
 * estados conhecidos (verificado, pendente, falhou, etc.) — diferente
 * do `<TagPills>` que usa cor aleatória estável por hash pra tags livres.
 *
 * Padrão visual: `rounded-full`, border 40%, bg 15%, text-300, text xs/sm.
 *
 * Variantes:
 *  - success: emerald (verificado, ok, sucesso)
 *  - warning: amber (pendente, atenção, "não verificado")
 *  - danger: rose (erro, rejeitado, falhou)
 *  - info: sky (neutro informativo)
 *  - neutral: slate (estado sem destaque)
 *  - brand: cyan (destaque/marca)
 */
export function StatusBadge({
  children,
  variant = 'neutral',
  icon,
  size = 'xs',
  className,
}: StatusBadgeProps) {
  const sizeClasses =
    size === 'sm' ? 'px-2.5 py-1 text-xs gap-1.5' : 'px-2 py-0.5 text-[11px] gap-1';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        sizeClasses,
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
