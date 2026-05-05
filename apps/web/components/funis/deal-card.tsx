'use client';

import { forwardRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, Sparkles } from 'lucide-react';
import type { BoardDealItem } from '@/lib/api/pipelines';
import { InitialsAvatar } from '@/components/contacts/initials-avatar';
import { tagColor } from '@/components/contacts/tag-pills';
import { AIScoreCircle } from './ai-score-circle';
import { RiskPill } from './risk-pill';
import { TimeInStage } from './time-in-stage';
import { cn } from '@/lib/utils';

interface DealCardProps {
  deal: BoardDealItem;
  onSelect: () => void;
}

export function DealCard({ deal, onSelect }: DealCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: deal.id, data: { type: 'deal', stageId: deal.stage_id } });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <DealCardVisual
      ref={setNodeRef}
      deal={deal}
      isDragging={isDragging}
      style={style}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    />
  );
}

// ──────────────────────────────────────────────────────────
// Visual puro (separado pra reuso no DragOverlay)
// ──────────────────────────────────────────────────────────

interface DealCardVisualProps extends React.HTMLAttributes<HTMLDivElement> {
  deal: BoardDealItem;
  isDragging?: boolean;
  /** True quando renderizado como DragOverlay (rotação levina + shadow forte) */
  isOverlay?: boolean;
}

export const DealCardVisual = forwardRef<HTMLDivElement, DealCardVisualProps>(
  ({ deal, isDragging, isOverlay, className, ...props }, ref) => {
    const closeDate = deal.expected_close_date
      ? new Date(deal.expected_close_date).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: 'short',
        })
      : null;

    const tags = deal.tags ?? [];
    const visibleTags = tags.slice(0, 2);
    const remainingTags = tags.length - visibleTags.length;

    return (
      <div
        ref={ref}
        // data-no-pan: o useDragToPan do board ignora pointerdown originado
        // aqui. Sem isso, ao começar drag de card o pan também ativa
        // (movendo as colunas junto) e setPointerCapture do pan rouba os
        // eventos do dnd-kit, deixando o cursor "preso" até o user clicar.
        data-no-pan
        className={cn(
          'group flex cursor-grab flex-col gap-2 rounded-lg border border-border bg-background p-3 shadow-sm transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md',
          isDragging && 'opacity-30',
          isOverlay && 'rotate-1 cursor-grabbing border-primary/50 shadow-2xl',
          // Pulso vermelho quando o deal está fora do SLA — atrai atenção
          // do agente sem ser invasivo. Keyframe em globals.css.
          deal.sla_breached && !isOverlay && 'sla-pulse',
          className,
        )}
        {...props}
      >
        {/* Linha 0: número discreto */}
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>
            #{deal.deal_number ? deal.deal_number : deal.id.slice(-4).toUpperCase()}
          </span>
        </div>

        {/* Linha 1: título + valor */}
        <div className="flex items-start justify-between gap-2">
          <h4 className="line-clamp-2 flex-1 text-sm font-semibold leading-tight text-foreground">
            {deal.title}
          </h4>
          <span className="shrink-0 text-sm font-bold text-primary tabular-nums">
            {formatBRL(deal.value)}
          </span>
        </div>

        {/* Linha 2: contato */}
        {deal.contact_name && (
          <div className="flex items-center gap-2 text-xs">
            <InitialsAvatar
              name={deal.contact_name}
              src={deal.contact_avatar}
              className="h-5 w-5 text-[9px]"
            />
            <span className="truncate text-muted-foreground">{deal.contact_name}</span>
          </div>
        )}

        {/* Linha 3: AI Score + Risk + Tempo no stage */}
        <div className="flex items-center gap-2">
          <AIScoreCircle score={deal.ai_score ?? 0} size={32} />
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            <RiskPill risk={deal.ai_risk} />
            <TimeInStage hours={deal.hours_in_stage ?? 0} slaBreached={deal.sla_breached} />
          </div>
        </div>

        {/* Linha 4: Next Action */}
        {deal.ai_next_action && (
          <div className="flex items-start gap-1.5 rounded-md bg-primary/5 px-2 py-1 text-[11px] text-muted-foreground">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
            <span className="line-clamp-2">{deal.ai_next_action}</span>
          </div>
        )}

        {/* Footer: tags + data */}
        {(visibleTags.length > 0 || closeDate) && (
          <div className="flex items-center justify-between gap-2">
            {visibleTags.length > 0 && (
              <div className="flex min-w-0 flex-wrap gap-1">
                {visibleTags.map((tag) => {
                  const c = tagColor(tag);
                  return (
                    <span
                      key={tag}
                      className={cn(
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
                        c.border,
                        c.bg,
                        c.text,
                      )}
                    >
                      {tag}
                    </span>
                  );
                })}
                {remainingTags > 0 && (
                  <span className="text-[10px] text-muted-foreground">+{remainingTags}</span>
                )}
              </div>
            )}
            {closeDate && (
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Calendar className="h-2.5 w-2.5" />
                {closeDate}
              </span>
            )}
          </div>
        )}
      </div>
    );
  },
);
DealCardVisual.displayName = 'DealCardVisual';

function formatBRL(n: number): string {
  if (!Number.isFinite(n) || n === 0) return 'R$ —';
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
