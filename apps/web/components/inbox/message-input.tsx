'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  HelpCircle,
  Loader2,
  Lock,
  MessageSquare,
  Package,
  PhoneCall,
  Send,
  Sparkles,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AnimatedPromptSuggestions,
  type PromptSuggestion,
} from '@/components/ui/animated-prompt-suggestions';
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
  /** Quando passado, exibe botão "Mandar produto" — chat-panel monta
   *  o handler que abre o ProductPickerDialog. */
  onOpenProductPicker?: () => void;
}

export function MessageInput({
  onSend,
  disabled,
  prefill,
  onPrefillConsumed,
  compact = false,
  onOpenProductPicker,
}: MessageInputProps) {
  const t = useTranslations('inbox.messageInput');
  const [value, setValue] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const QUICK_REPLY_SUGGESTIONS = useMemo<PromptSuggestion[]>(
    () => [
      { text: t('quickReplies.greeting'), label: t('quickReplies.greetingLabel'), icon: MessageSquare, accent: '#00E5FF' },
      { text: t('quickReplies.wait'), label: t('quickReplies.waitLabel'), icon: Clock, accent: '#fcd34d' },
      { text: t('quickReplies.time'), label: t('quickReplies.timeLabel'), icon: CalendarClock, accent: '#a78bfa' },
      { text: t('quickReplies.docs'), label: t('quickReplies.docsLabel'), icon: FileText, accent: '#67e8f9' },
      { text: t('quickReplies.insurance'), label: t('quickReplies.insuranceLabel'), icon: HelpCircle, accent: '#fde68a' },
      { text: t('quickReplies.forward'), label: t('quickReplies.forwardLabel'), icon: PhoneCall, accent: '#34d399' },
      { text: t('quickReplies.confirm'), label: t('quickReplies.confirmLabel'), icon: CheckCircle2, accent: '#34d399' },
      { text: t('quickReplies.more'), label: t('quickReplies.moreLabel'), icon: Sparkles, accent: '#f472b6' },
    ],
    [t],
  );

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
      // O hook (useChat.send) já trata o erro de envio normal com bolha
      // 'failed' + toast. Aqui é rede de segurança pra throws inesperados:
      // avisa o usuário e NÃO limpa o input pra ele tentar de novo.
      console.error('Failed to send:', err);
      toast.error(t('sendFailed'));
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
          {isInternalNote ? t('toggleInternalNote') : t('toggleMessage')}
        </button>
        {!compact && (
          <span className="text-[10px] text-muted-foreground">
            {t('shortcutHint')}
          </span>
        )}
      </div>

      {/* Quando vazio E não é nota interna, mostra carrossel de respostas
          rápidas acima do input. Disponível só em modo full (compact=false)
          pra não tomar espaço em drawers laterais estreitos. */}
      {!compact && !value && !isInternalNote && (
        <AnimatedPromptSuggestions
          className="mb-2"
          suggestions={QUICK_REPLY_SUGGESTIONS}
          onSuggestionClick={(text) => {
            setValue(text);
            focusInput();
          }}
          rows={1}
          compact
          speed={45}
        >
          <></>
        </AnimatedPromptSuggestions>
      )}

      <div className="flex items-end gap-2">
        {!compact && onOpenProductPicker && (
          <Button variant="ghost" size="icon" aria-label={t('sendProductAria')}
            onClick={onOpenProductPicker}
            disabled={disabled || sending || isInternalNote}
            title={t('sendProductTitle')}>
            <Package className="h-4 w-4 text-primary" />
          </Button>
        )}

        <Textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            isInternalNote
              ? t('placeholderInternalNote')
              : t('placeholderMessage')
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
          aria-label={t('sendAria')}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
