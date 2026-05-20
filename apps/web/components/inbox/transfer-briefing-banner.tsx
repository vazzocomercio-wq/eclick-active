'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, FileText, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ConversationDetail } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

interface TransferBriefing {
  generated_at: string;
  reason: string;
  customer: { name: string | null; phone: string | null; channel: string };
  conversation: { id: string; started_at: string; message_count: number };
  ai_summary: string | null;
  ai_intent: string | null;
  ai_sentiment: string | null;
  ai_temperature: string | null;
  customer_wants: string;
  objections: string[];
  collected_data: string[];
  missing_data: string[];
  products_of_interest: string[];
  approach_suggestion: string;
}

interface TransferBriefingBannerProps {
  conversation: ConversationDetail | null;
}

export function TransferBriefingBanner({ conversation }: TransferBriefingBannerProps) {
  const t = useTranslations('inbox.transferBriefing');
  const [expanded, setExpanded] = useState(false);
  const briefing = (conversation?.metadata as Record<string, unknown> | null)?.transfer_briefing as
    | TransferBriefing
    | undefined;

  if (!briefing) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-amber-500/10"
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
        <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">
          {t('title', { reason: briefing.reason })}
        </span>
        <span className="ml-auto text-[10px] text-amber-700/70 dark:text-amber-300/70">
          {expanded ? t('collapse') : t('expand')}
        </span>
        {expanded ? (
          <ChevronUp className="h-3 w-3 text-amber-700 dark:text-amber-300" />
        ) : (
          <ChevronDown className="h-3 w-3 text-amber-700 dark:text-amber-300" />
        )}
      </button>

      {expanded && (
        <div className="grid gap-3 border-t border-amber-500/20 px-4 py-3 text-xs md:grid-cols-2">
          <BriefingCard title={t('customerWants')} content={briefing.customer_wants} />
          <BriefingCard
            title={t('approachSuggestion')}
            content={briefing.approach_suggestion}
            icon={<Sparkles className="h-3 w-3" />}
          />

          {briefing.objections.length > 0 && (
            <BriefingList title={t('objections')} items={briefing.objections} />
          )}
          {briefing.products_of_interest.length > 0 && (
            <BriefingList
              title={t('products')}
              items={briefing.products_of_interest}
            />
          )}

          <div className="md:col-span-2 grid gap-3 sm:grid-cols-3">
            <BriefingChips
              label={t('collected')}
              items={briefing.collected_data}
              tone="positive"
              empty={t('empty')}
            />
            <BriefingChips label={t('missing')} items={briefing.missing_data} tone="warning" empty={t('empty')} />
            <BriefingChips
              label={t('aiSignals')}
              items={[briefing.ai_intent, briefing.ai_sentiment, briefing.ai_temperature].filter(
                (v): v is string => !!v,
              )}
              tone="neutral"
              empty={t('empty')}
            />
          </div>

          <div className="md:col-span-2 text-[10px] text-muted-foreground">
            {t('footer', {
              time: new Date(briefing.generated_at).toLocaleString('pt-BR'),
              count: briefing.conversation.message_count,
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BriefingCard({
  title,
  content,
  icon,
}: {
  title: string;
  content: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </div>
      <p className="mt-1 leading-relaxed">{content}</p>
    </div>
  );
}

function BriefingList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <ul className="mt-1 space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="leading-relaxed">
            • {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BriefingChips({
  label,
  items,
  tone,
  empty,
}: {
  label: string;
  items: string[];
  tone: 'positive' | 'warning' | 'neutral';
  empty: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {items.length === 0 ? (
        <span className="text-muted-foreground">{empty}</span>
      ) : (
        <div className="mt-1 flex flex-wrap gap-1">
          {items.map((it, i) => (
            <span
              key={i}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px]',
                tone === 'positive' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                tone === 'warning' && 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
                tone === 'neutral' && 'bg-muted text-muted-foreground',
              )}
            >
              {it}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
