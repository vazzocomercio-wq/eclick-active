'use client';

import { useState } from 'react';
import { Loader2, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { toast } from 'sonner';
import { aiApi, type AIFeedback } from '@/lib/api/ai';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface AIFeedbackButtonsProps {
  /** ID da row em ai_interactions. Sem id, o componente não renderiza. */
  interactionId: string | null | undefined;
  /** Tamanho dos ícones — drawers/inbox compactos podem usar `xs`. */
  size?: 'xs' | 'sm';
  /** Alinhamento horizontal dentro do espaço disponível. */
  align?: 'start' | 'end';
  /** Classes extras no container. */
  className?: string;
}

/**
 * Botões discretos 👍/👎 que aparecem no rodapé de respostas de IA.
 *
 * Visual:
 *   - Estado normal: ícones ghost (cor `muted`), aparecem com baixa
 *     opacidade; container `group-hover:opacity-100` garante que ficam
 *     mais visíveis quando o usuário passa o mouse na bolha.
 *   - Após click: o ícone clicado fica solid (verde pra 👍, vermelho pra 👎).
 *   - 👎 abre um mini textarea opcional "O que poderia ser melhor?" — é
 *     submetido em segundo PATCH; cancelar fecha sem reverter o feedback.
 *
 * O componente cuida de toda a comunicação com o backend; o caller só
 * passa o `interactionId`.
 */
export function AIFeedbackButtons({
  interactionId,
  size = 'sm',
  align = 'end',
  className,
}: AIFeedbackButtonsProps) {
  const [submitted, setSubmitted] = useState<AIFeedback | null>(null);
  const [pending, setPending] = useState<AIFeedback | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');
  const [savingComment, setSavingComment] = useState(false);

  if (!interactionId) return null;

  const iconSize = size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const buttonSize = size === 'xs' ? 'h-5 w-5' : 'h-6 w-6';

  async function send(kind: AIFeedback, withComment?: string) {
    if (!interactionId) return;
    setPending(kind);
    try {
      await aiApi.submitFeedback(interactionId, {
        feedback: kind,
        ...(withComment ? { comment: withComment } : {}),
      });
      setSubmitted(kind);
      if (kind === 'negative' && !withComment) {
        // Abre prompt opcional só na primeira vez
        setShowComment(true);
      }
    } catch (err) {
      toast.error('Falha ao enviar feedback', {
        description:
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro desconhecido',
      });
    } finally {
      setPending(null);
    }
  }

  async function handleSubmitComment() {
    const text = comment.trim();
    if (!text || savingComment) return;
    setSavingComment(true);
    try {
      await aiApi.submitFeedback(interactionId!, {
        feedback: 'negative',
        comment: text,
      });
      setComment('');
      setShowComment(false);
      toast.success('Obrigado pelo feedback!');
    } catch (err) {
      toast.error('Falha ao salvar comentário', {
        description:
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro desconhecido',
      });
    } finally {
      setSavingComment(false);
    }
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div
        className={cn(
          'flex items-center gap-0.5',
          align === 'end' ? 'justify-end' : 'justify-start',
          // Quando ainda não houve feedback, fica meio escondido até o hover.
          // Após feedback, fica permanentemente visível.
          submitted ? 'opacity-100' : 'opacity-50 transition-opacity group-hover:opacity-100',
        )}
      >
        <button
          type="button"
          onClick={() => void send('positive')}
          disabled={pending !== null}
          aria-label="Resposta útil"
          aria-pressed={submitted === 'positive'}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-md transition-colors',
            buttonSize,
            submitted === 'positive'
              ? 'bg-emerald-500/15 text-emerald-500'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            pending === 'positive' && 'animate-pulse',
          )}
        >
          {pending === 'positive' ? (
            <Loader2 className={cn(iconSize, 'animate-spin')} />
          ) : (
            <ThumbsUp
              className={iconSize}
              fill={submitted === 'positive' ? 'currentColor' : 'none'}
              strokeWidth={1.75}
            />
          )}
        </button>

        <button
          type="button"
          onClick={() => void send('negative')}
          disabled={pending !== null}
          aria-label="Resposta ruim"
          aria-pressed={submitted === 'negative'}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-md transition-colors',
            buttonSize,
            submitted === 'negative'
              ? 'bg-red-500/15 text-red-500'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            pending === 'negative' && 'animate-pulse',
          )}
        >
          {pending === 'negative' ? (
            <Loader2 className={cn(iconSize, 'animate-spin')} />
          ) : (
            <ThumbsDown
              className={iconSize}
              fill={submitted === 'negative' ? 'currentColor' : 'none'}
              strokeWidth={1.75}
            />
          )}
        </button>
      </div>

      {showComment && submitted === 'negative' && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>O que poderia ser melhor?</span>
            <button
              type="button"
              onClick={() => {
                setShowComment(false);
                setComment('');
              }}
              aria-label="Fechar"
              className="rounded-sm p-0.5 hover:bg-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Resposta imprecisa, contexto errado, formato ruim..."
            rows={2}
            className="min-h-[48px] resize-none text-xs"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSubmitComment}
              disabled={!comment.trim() || savingComment}
              className="h-6 px-2 text-[11px]"
            >
              {savingComment && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Enviar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
