'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Lock, Paperclip, Send, Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface MessageInputProps {
  onSend: (text: string, isInternalNote: boolean) => Promise<void>;
  disabled?: boolean;
  /** Texto pré-preenchido (ex: vindo de sugestão IA) */
  prefill?: string;
  onPrefillConsumed?: () => void;
}

export function MessageInput({
  onSend,
  disabled,
  prefill,
  onPrefillConsumed,
}: MessageInputProps) {
  const [value, setValue] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Aplica prefill (sugestão IA → input)
  useEffect(() => {
    if (prefill !== undefined && prefill !== '') {
      setValue(prefill);
      onPrefillConsumed?.();
      // foca + posiciona cursor no fim
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
      });
    }
  }, [prefill, onPrefillConsumed]);

  // Auto-resize do textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  async function submit() {
    const text = value.trim();
    if (!text || sending || disabled) return;
    setSending(true);
    try {
      await onSend(text, isInternalNote);
      setValue('');
      setIsInternalNote(false);
    } catch (err) {
      // Erros já são logados pelo hook; aqui só não limpa o input pro user
      // tentar de novo.
      console.error('Failed to send:', err);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div
      className={cn(
        'border-t border-border p-3 transition-colors',
        isInternalNote && 'bg-yellow-500/5',
      )}
    >
      {/* Toggle nota interna */}
      <div className="mb-2 flex items-center justify-between text-xs">
        <button
          type="button"
          onClick={() => setIsInternalNote((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors',
            isInternalNote
              ? 'bg-yellow-500/15 text-yellow-500'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Lock className="h-3 w-3" />
          {isInternalNote ? 'Nota interna' : 'Mensagem'}
        </button>
        <span className="text-[10px] text-muted-foreground">
          Enter envia · Shift+Enter quebra linha
        </span>
      </div>

      <div className="flex items-end gap-2">
        <Button variant="ghost" size="icon" aria-label="Emoji" disabled>
          <Smile className="h-4 w-4 text-muted-foreground" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Anexar" disabled>
          <Paperclip className="h-4 w-4 text-muted-foreground" />
        </Button>

        <Textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            isInternalNote
              ? 'Nota interna (só agentes veem)...'
              : 'Digite sua mensagem...'
          }
          rows={1}
          disabled={disabled || sending}
          className="min-h-[40px] flex-1 resize-none"
        />

        <Button
          type="button"
          onClick={submit}
          disabled={!value.trim() || sending || disabled}
          aria-label="Enviar"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
