'use client';

import { AlertTriangle, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AIFeedbackButtons } from '@/components/ai/ai-feedback-buttons';
import { cn } from '@/lib/utils';

/** Bloco G PARTE 3 — abaixo desse limiar, marca como "baixa confiança" */
const LOW_CONFIDENCE_THRESHOLD = 0.6;

interface AISuggestionBarProps {
  suggestion: string | null;
  confidence?: number;
  /** ID da interação no backend — habilita 👍/👎 quando presente. */
  aiInteractionId?: string | null;
  onUse: () => void;
  onEdit: () => void;
  onIgnore: () => void;
}

/**
 * Mostrada acima do input quando a IA tem sugestão pra mensagem.
 * Conecta via `useEvents({ onAISuggestion })` que recebe socket.io payload
 * com `ai_interaction_id` — quando presente, exibe botões 👍/👎 pra
 * coletar feedback da qualidade da sugestão.
 */
export function AISuggestionBar({
  suggestion,
  confidence,
  aiInteractionId,
  onUse,
  onEdit,
  onIgnore,
}: AISuggestionBarProps) {
  if (!suggestion) return null;

  const isLowConfidence =
    confidence !== undefined && confidence < LOW_CONFIDENCE_THRESHOLD;

  return (
    <div
      className={cn(
        'flex items-start gap-3 border-t px-4 py-2',
        isLowConfidence
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-primary/30 bg-primary/5',
      )}
    >
      {isLowConfidence ? (
        <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0 text-destructive" />
      ) : (
        <Sparkles className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
      )}
      <div className="group flex-1 min-w-0">
        <div className="mb-1 flex items-center gap-2">
          <span
            className={cn(
              'text-[10px] font-semibold uppercase tracking-wider',
              isLowConfidence ? 'text-destructive' : 'text-primary',
            )}
          >
            {isLowConfidence ? '⚠️ Sugestão IA — baixa confiança' : 'Sugestão IA'}
          </span>
          {confidence !== undefined && (
            <span
              className={cn(
                'text-[10px]',
                isLowConfidence ? 'font-semibold text-destructive' : 'text-muted-foreground',
              )}
            >
              {Math.round(confidence * 100)}%
            </span>
          )}
          {aiInteractionId && (
            <div className="ml-auto">
              <AIFeedbackButtons interactionId={aiInteractionId} size="xs" align="end" />
            </div>
          )}
        </div>
        <p className="line-clamp-2 text-sm">{suggestion}</p>
        {isLowConfidence && (
          <p className="mt-0.5 text-[11px] text-destructive/80">
            Revise com cuidado antes de enviar — uma tarefa foi criada pra você analisar.
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm"
          variant={isLowConfidence ? 'outline' : 'default'}
          onClick={onUse}
        >
          {isLowConfidence ? 'Enviar mesmo assim' : 'Usar'}
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          Editar
        </Button>
        <Button size="icon" variant="ghost" onClick={onIgnore} aria-label="Ignorar">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
