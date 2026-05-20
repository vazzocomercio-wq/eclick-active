'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const INTENT_KEYS = new Set([
  'budget', 'question', 'complaint', 'negotiation', 'support',
  'greeting', 'farewell', 'spam', 'other',
]);
const SENTIMENT_KEYS = new Set([
  'very_positive', 'positive', 'neutral', 'negative', 'very_negative',
]);
const TEMPERATURE_KEYS = new Set([
  'cold', 'warm', 'hot', 'very_hot',
]);

interface InlineAISummaryProps {
  summary: string;
  /** Marker pra mostrar "recém gerado" vs "última atualização" */
  generatedAt?: string | null;
  /** Badges classificatórios — vêm do detail.ai_intent/ai_sentiment/ai_temperature */
  intent?: string | null;
  sentiment?: string | null;
  temperature?: string | null;
  /** Se true, mostra timestamp como "recém gerado" (resumo recém-clicou Resumir) */
  fresh?: boolean;
  onDismiss?: () => void;
  /** Compact reduz padding/text-size pra caber em drawers */
  compact?: boolean;
}

/**
 * Card inline de resumo IA — exibido entre lista de mensagens e input.
 * Visual: borda esquerda cyan, fundo cyan/5 (light) ou cyan/10 (dark),
 * ícone Sparkles + label "Resumo da IA" + texto + badges de classificação.
 *
 * Substitui o antigo SummaryBubble (visual primary). Cores cyan diferenciam
 * de outros banners do chat (briefing transferência = primary, sugestão IA
 * = primary/destructive, mensagens = card padrão).
 */
export function InlineAISummary({
  summary,
  generatedAt,
  intent,
  sentiment,
  temperature,
  fresh = false,
  onDismiss,
  compact = false,
}: InlineAISummaryProps) {
  const t = useTranslations('chat.summary');
  const [open, setOpen] = useState(true);

  const intentPt = intent && INTENT_KEYS.has(intent) ? t(`intentLabels.${intent}`) : intent ?? null;
  const sentimentPt = sentiment && SENTIMENT_KEYS.has(sentiment) ? t(`sentimentLabels.${sentiment}`) : sentiment ?? null;
  const temperaturePt = temperature && TEMPERATURE_KEYS.has(temperature) ? t(`temperatureLabels.${temperature}`) : temperature ?? null;
  const hasBadges = !!(intentPt || sentimentPt || temperaturePt);

  const timestampLabel = fresh
    ? t('fresh')
    : generatedAt
      ? t('generatedAt', { time: formatTime(generatedAt, t) })
      : null;

  const padding = compact ? 'px-3 py-2' : 'px-4 py-3';
  const labelSize = compact ? 'text-[9px]' : 'text-[10px]';

  return (
    <div
      className={cn(
        'animate-in fade-in slide-in-from-top-1 border-y border-l-2 border-l-cyan-500',
        'border-cyan-500/20 bg-cyan-500/5 dark:bg-cyan-500/10',
      )}
    >
      {/* Header clicável (toggle expand/collapse) — segue mesmo padrão
          do AIInsightsCard ("ATENÇÃO DA IA") */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 transition-colors hover:bg-cyan-500/10',
          padding,
        )}
        aria-expanded={open}
      >
        <span
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full',
            'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
            compact ? 'h-4 w-4' : 'h-5 w-5',
          )}
        >
          <Sparkles className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
        </span>
        <span
          className={cn(
            'font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300',
            labelSize,
          )}
        >
          {t('title')}
        </span>
        {timestampLabel && (
          <span className={cn('text-muted-foreground', labelSize)}>{timestampLabel}</span>
        )}
        <span className="ml-auto flex items-center gap-1 text-muted-foreground">
          {onDismiss && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onDismiss();
                }
              }}
              aria-label={t('dismissAria')}
              className={cn(
                'rounded-md p-1 transition-colors hover:bg-cyan-500/10 hover:text-foreground',
              )}
            >
              <X className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
            </span>
          )}
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </span>
      </button>

      {open && (
        <div className={cn('flex flex-col gap-1 pt-0', padding)}>
          <p
            className={cn(
              'whitespace-pre-wrap break-words leading-relaxed',
              compact ? 'text-xs' : 'text-sm',
            )}
          >
            {summary}
          </p>
          {hasBadges && (
            <div className={cn('mt-1 flex flex-wrap gap-1', labelSize)}>
              {intentPt && <Pill label={t('intent')} value={intentPt} />}
              {sentimentPt && <Pill label={t('sentiment')} value={sentimentPt} />}
              {temperaturePt && <Pill label={t('temperature')} value={temperaturePt} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-cyan-500/10 px-1.5 py-0.5 text-cyan-800 dark:text-cyan-300">
      <span className="font-semibold uppercase tracking-wider opacity-70">{label}:</span>
      <span>{value}</span>
    </span>
  );
}

function formatTime(
  iso: string,
  t: (key: string, vars?: Record<string, number>) => string,
): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = Date.now();
    const diffMin = Math.floor((now - d.getTime()) / 60_000);
    if (diffMin < 1) return t('now');
    if (diffMin < 60) return t('minutesAgo', { n: diffMin });
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return t('hoursAgo', { n: diffH });
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return t('daysAgo', { n: diffD });
    return d.toLocaleDateString('pt-BR');
  } catch {
    return '';
  }
}
