'use client';

import { Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AIFeedbackButtons } from '@/components/ai/ai-feedback-buttons';

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

  return (
    <div className="flex items-start gap-3 border-t border-primary/30 bg-primary/5 px-4 py-2">
      <Sparkles className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
      <div className="group flex-1 min-w-0">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            Sugestão IA
          </span>
          {confidence !== undefined && (
            <span className="text-[10px] text-muted-foreground">
              {Math.round(confidence * 100)}% confiança
            </span>
          )}
          {aiInteractionId && (
            <div className="ml-auto">
              <AIFeedbackButtons interactionId={aiInteractionId} size="xs" align="end" />
            </div>
          )}
        </div>
        <p className="line-clamp-2 text-sm">{suggestion}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button size="sm" onClick={onUse}>
          Usar
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
