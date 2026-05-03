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
  /**
   * Modo compacto (drawers, painéis embutidos): sem botões emoji/anexo,
   * padding reduzido, hint da combinação de teclas escondido.
   */
  compact?: boolean;
}

export function MessageInput({
  onSend,
  disabled,
  prefill,
  onPrefillConsumed,
  compact = false,
}: MessageInputProps) {
  const [value, setValue] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Foca o textarea de forma robusta. requestAnimationFrame garante que
   * o foco rode DEPOIS do React aplicar o último render (caso esteja
   * desabilitado durante envio, por ex). Usado em vários momentos:
   * mount, depois de enviar, quando o input volta a estar habilitado.
   */
  function focusInput(): void {
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta || ta.disabled) return;
      ta.focus();
    });
  }

  // 1) Foca no mount (conversa abriu)
  useEffect(() => {
    focusInput();
  }, []);

  // 2) Foca quando o input volta a ficar habilitado (terminou de enviar,
  //    ou conversa carregou e disabled passou de true → false)
  useEffect(() => {
    if (!disabled && !sending) {
      focusInput();
    }
  }, [disabled, sending]);

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
      // Re-foca após enviar (sucesso ou erro). O useEffect [disabled,sending]
      // também cobre, mas chamar explícito aqui torna o comportamento
      // imediato e independente de mudança de prop.
      focusInput();
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
        'border-t border-border transition-colors',
        compact ? 'p-2' : 'p-3',
        isInternalNote && 'bg-yellow-500/5',
      )}
    >
      {/* Toggle nota interna */}
      <div className={cn('flex items-center justify-between text-xs', compact ? 'mb-1.5' : 'mb-2')}>
        <button
          type="button"
          onClick={() => setIsInternalNote((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors',
            compact && 'text-[11px]',
            isInternalNote
              ? 'bg-yellow-500/15 text-yellow-500'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Lock className="h-3 w-3" />
          {isInternalNote ? 'Nota interna' : 'Mensagem'}
        </button>
        {!compact && (
          <span className="text-[10px] text-muted-foreground">
            Enter envia · Shift+Enter quebra linha
          </span>
        )}
      </div>

      <div className="flex items-end gap-2">
        {!compact && (
          <>
            <Button variant="ghost" size="icon" aria-label="Emoji" disabled>
              <Smile className="h-4 w-4 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Anexar" disabled>
              <Paperclip className="h-4 w-4 text-muted-foreground" />
            </Button>
          </>
        )}

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
          className={cn(
            'flex-1 resize-none',
            compact ? 'min-h-[36px] text-[13px]' : 'min-h-[40px]',
          )}
        />

        <Button
          type="button"
          onClick={submit}
          disabled={!value.trim() || sending || disabled}
          size={compact ? 'sm' : 'default'}
          aria-label="Enviar"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
