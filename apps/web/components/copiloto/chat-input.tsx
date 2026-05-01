'use client';

import { useEffect, useRef } from 'react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}

const MAX_HEIGHT_PX = 200;

export function ChatInput({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
}: ChatInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
  }, [value]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim().length > 0) onSubmit();
    }
  }

  const canSubmit = !disabled && value.trim().length > 0;

  return (
    <div
      className={cn(
        'flex items-end gap-2 rounded-2xl border border-border bg-card p-2 transition-colors',
        'focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/20',
      )}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'Pergunte sobre seus leads, deals, performance...'}
        rows={1}
        disabled={disabled}
        className="flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
        style={{ maxHeight: MAX_HEIGHT_PX }}
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        aria-label="Enviar"
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all',
          canSubmit
            ? 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95'
            : 'bg-muted text-muted-foreground',
        )}
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}
