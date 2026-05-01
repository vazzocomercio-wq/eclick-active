'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatInput } from '@/components/copiloto/chat-input';
import {
  ChatMessageItem,
  TypingIndicator,
} from '@/components/copiloto/chat-message';
import { useCopilot } from '@/hooks/use-copilot';
import { cn } from '@/lib/utils';

const QUICK_SUGGESTIONS = [
  'Quais leads priorizar hoje?',
  'Resumo do meu funil',
  'Tarefas pendentes',
  'Por que perdi vendas esta semana?',
  'Crie follow-up para leads sem resposta',
];

export default function CopilotoPage() {
  const { messages, thinking, loadingHistory, error, send, clear } = useCopilot();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll para o fim em qualquer nova mensagem ou no load do histórico
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, thinking, loadingHistory]);

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput('');
    void send(trimmed);
  }

  function handleSuggestion(text: string) {
    setInput('');
    void send(text);
  }

  const isEmpty = !loadingHistory && messages.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-semibold">Copiloto IA</h1>
            <span className="inline-flex items-center gap-0.5 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" />
              AI
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Seu assistente comercial inteligente. Pergunte qualquer coisa sobre seu CRM.
          </p>
        </div>

        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => void clear()}>
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Limpar
          </Button>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {loadingHistory ? (
            <SkeletonHistory />
          ) : isEmpty ? (
            <EmptyState />
          ) : (
            messages.map((m) => <ChatMessageItem key={m.id} message={m} />)
          )}

          {thinking && <TypingIndicator />}
        </div>
      </div>

      <div className="border-t border-border bg-background/95 px-4 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {isEmpty && (
            <QuickSuggestions onSelect={handleSuggestion} disabled={thinking} />
          )}

          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            disabled={thinking}
          />

          <p className="text-center text-[11px] text-muted-foreground">
            Enter para enviar · Shift+Enter para nova linha
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Bot className="h-7 w-7" />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Como posso ajudar hoje?</h2>
        <p className="max-w-md text-xs text-muted-foreground">
          Pergunte sobre leads, deals, performance, conversas ou peça para criar tarefas e
          oportunidades direto pelo chat.
        </p>
      </div>
    </div>
  );
}

function QuickSuggestions({
  onSelect,
  disabled,
}: {
  onSelect: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {QUICK_SUGGESTIONS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onSelect(s)}
          disabled={disabled}
          className={cn(
            'rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors',
            'hover:border-primary/40 hover:bg-primary/5 hover:text-primary',
            disabled && 'pointer-events-none opacity-50',
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function SkeletonHistory() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className={cn('flex gap-3', i % 2 === 0 ? 'flex-row' : 'flex-row-reverse')}>
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted" />
          <div
            className={cn('h-12 animate-pulse rounded-2xl bg-muted', i % 2 === 0 ? 'w-2/3' : 'w-1/2')}
          />
        </div>
      ))}
    </div>
  );
}
