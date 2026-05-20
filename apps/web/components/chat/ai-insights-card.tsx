'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Lightbulb,
  Loader2,
  UserX,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { aiApi, type GapsResult } from '@/lib/api/ai';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface AIInsightsCardProps {
  conversationId: string | null;
  /** Trigger pra refetch quando uma nova mensagem chega — debounced 30s no parent */
  refreshKey?: number | string;
  /**
   * Callback quando o agente clica em "Perguntar agora" num campo faltando.
   * Recebe a sugestão pronta — tipicamente preenche o input do chat.
   */
  onAskNow?: (suggestion: string) => void;
  /**
   * Callback quando o agente clica numa pergunta pendente.
   * Recebe o message_index — pai pode scrollar até a mensagem correspondente.
   */
  onScrollToMessage?: (messageIndex: number) => void;
  /** Modo compact — usado em drawers, reduz padding/font. */
  compact?: boolean;
}

/**
 * Card colapsável "Atenção da IA" — exibe gaps detectados via Haiku
 * (perguntas sem resposta + dados de perfil faltando + ações sugeridas).
 *
 * Posicionado acima do input no ChatPanel. Aparece automaticamente quando
 * a conversa tem gaps; pode ser fechado pelo agente. Refetch debounced
 * 30s ao chegar nova mensagem (controlado pelo parent via refreshKey).
 *
 * Cores: amarelo (warning) — diferencia do InlineAISummary (cyan) e do
 * AISuggestionBar (primary).
 */
export function AIInsightsCard({
  conversationId,
  refreshKey,
  onAskNow,
  onScrollToMessage,
  compact = false,
}: AIInsightsCardProps) {
  const t = useTranslations('chat.aiInsights');
  const tAsk = useTranslations('chat.askMessages');
  const [gaps, setGaps] = useState<GapsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const lastConvId = useRef<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setGaps(null);
      return;
    }
    // Reset estado de dismiss ao trocar de conversa
    if (lastConvId.current !== conversationId) {
      setDismissed(false);
      lastConvId.current = conversationId;
    }

    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    aiApi
      .getGaps(conversationId, ctrl.signal)
      .then(setGaps)
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : t('errorPrefix'),
        );
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [conversationId, refreshKey]);

  if (!conversationId || dismissed) return null;

  const hasGaps =
    gaps &&
    (gaps.unanswered_questions.length > 0 ||
      gaps.missing_profile_data.length > 0 ||
      gaps.suggested_actions.length > 0);

  // Não renderiza nada se carregou e não há gaps
  if (!loading && !hasGaps && !error) return null;

  const padding = compact ? 'px-3 py-2' : 'px-4 py-2';
  const headerText = compact ? 'text-[11px]' : 'text-xs';

  return (
    <div
      className={cn(
        'animate-in fade-in slide-in-from-bottom-1 border-y border-l-2 border-l-yellow-500',
        'border-yellow-500/20 bg-yellow-500/5 dark:bg-yellow-500/10',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 transition-colors hover:bg-yellow-500/10',
          padding,
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
        <span
          className={cn(
            'font-semibold uppercase tracking-wider text-yellow-700 dark:text-yellow-300',
            headerText,
          )}
        >
          {t('title')}
        </span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {gaps && hasGaps && (
          <span className="text-[10px] text-muted-foreground">
            {t('pendings', { count: gaps.unanswered_questions.length + gaps.missing_profile_data.length })}
            {gaps.suggested_actions.length > 0 && ` ${t('suggestions', { count: gaps.suggested_actions.length })}`}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-muted-foreground">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </span>
      </button>

      {open && (
        <div className={cn('flex flex-col gap-2 pt-0', padding)}>
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
              {error}
            </p>
          )}

          {/* Perguntas sem resposta */}
          {gaps && gaps.unanswered_questions.length > 0 && (
            <Section title={t('unansweredSection')} compact={compact}>
              {gaps.unanswered_questions.map((q, i) => (
                <Row
                  key={`q-${i}`}
                  icon={HelpCircle}
                  label={q.question}
                  actionLabel={onScrollToMessage ? t('viewMessage') : undefined}
                  onAction={() => onScrollToMessage?.(q.message_index)}
                  compact={compact}
                />
              ))}
            </Section>
          )}

          {/* Dados faltando */}
          {gaps && gaps.missing_profile_data.length > 0 && (
            <Section title={t('missingSection')} compact={compact}>
              {gaps.missing_profile_data.map((m, i) => (
                <Row
                  key={`m-${i}`}
                  icon={UserX}
                  label={
                    <span>
                      <span className="font-semibold">{m.field}</span>
                      <span className="text-muted-foreground"> — {m.reason}</span>
                    </span>
                  }
                  actionLabel={t('askNow')}
                  onAction={() => onAskNow?.(buildAskMessage(m.field, tAsk))}
                  compact={compact}
                />
              ))}
            </Section>
          )}

          {/* Sugestões */}
          {gaps && gaps.suggested_actions.length > 0 && (
            <Section title={t('suggestionsSection')} compact={compact}>
              {gaps.suggested_actions.map((a, i) => (
                <Row
                  key={`s-${i}`}
                  icon={Lightbulb}
                  label={a}
                  compact={compact}
                />
              ))}
            </Section>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('dismiss')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  compact,
}: {
  title: string;
  children: React.ReactNode;
  compact: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className={cn(
          'font-medium uppercase tracking-wider text-muted-foreground',
          compact ? 'text-[9px]' : 'text-[10px]',
        )}
      >
        {title}
      </span>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  actionLabel,
  onAction,
  compact,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  compact: boolean;
}) {
  return (
    <li
      className={cn(
        'flex items-start gap-1.5 rounded-md border border-yellow-500/20 bg-background/40 px-2 py-1',
        compact ? 'text-[11px]' : 'text-xs',
      )}
    >
      <Icon className="mt-0.5 h-3 w-3 shrink-0 text-yellow-600 dark:text-yellow-400" />
      <span className="flex-1 leading-snug">{label}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-yellow-700 transition-colors hover:bg-yellow-500/15 dark:text-yellow-400"
        >
          {actionLabel}
        </button>
      )}
    </li>
  );
}

/** Gera texto natural pra perguntar o dado ao cliente. */
function buildAskMessage(
  field: string,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  const f = field.toLowerCase();
  if (f.includes('email')) {
    return t('email');
  }
  if (f.includes('phone') || f.includes('telefone')) {
    return t('phone');
  }
  if (f.includes('name') || f.includes('nome')) {
    return t('name');
  }
  if (f.includes('company') || f.includes('empresa')) {
    return t('company');
  }
  if (f.includes('tag') || f.includes('segment')) {
    return t('tag');
  }
  return t('fallback', { field });
}
