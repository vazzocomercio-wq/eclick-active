'use client';

import { AlertTriangle, Globe, Sparkles, X } from 'lucide-react';
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
  /** Fontes live consultadas — exibe badge "Dados em tempo real". */
  liveSourcesUsed?: Array<{ id: string; name: string; url: string }>;
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
  liveSourcesUsed,
  onUse,
  onEdit,
  onIgnore,
}: AISuggestionBarProps) {
  if (!suggestion) return null;
  const hasLiveSources = (liveSourcesUsed?.length ?? 0) > 0;

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
        {hasLiveSources && (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
              <Globe className="h-2.5 w-2.5" />
              Dados em tempo real
            </span>
            <span className="text-muted-foreground">
              {liveSourcesUsed!.map((s) => s.name).join(', ')}
            </span>
          </div>
        )}
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
