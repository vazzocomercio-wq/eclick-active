'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { AIScoreCircle } from '@/components/funis/ai-score-circle';
import { RiskPill } from '@/components/funis/risk-pill';
import { contactsApi, type ContactDealItem } from '@/lib/api/contacts';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ContactDealsTabProps {
  contactId: string;
  /** Disparado ao clicar num deal — abre o Deal Detail Sheet do pai. */
  onOpenDeal?: (dealId: string) => void;
}

/**
 * Aba "Negócios" do Contact Detail Sheet — lista deals vinculados via
 * GET /contacts/:id/deals. Cards compactos com título, valor, stage
 * (com cor), score e risco. Click abre o Deal Detail Sheet via callback
 * (gerenciado pelo container pai pra não criar diamond imports).
 */
export function ContactDealsTab({ contactId, onOpenDeal }: ContactDealsTabProps) {
  const t = useTranslations('contacts.dealsTab');
  const [deals, setDeals] = useState<ContactDealItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    contactsApi
      .getDeals(contactId, ctrl.signal)
      .then(setDeals)
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : t('fetchError'),
        );
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [contactId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (!deals || deals.length === 0) {
    return (
      <Card className="m-4 border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Target className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium">{t('emptyTitle')}</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            {t('emptyDescription')}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <p className="text-[11px] text-muted-foreground">
        {deals.length === 1 ? t('linkedOne', { count: deals.length }) : t('linkedMany', { count: deals.length })}
      </p>
      {deals.map((d) => (
        <DealCard key={d.id} deal={d} onClick={() => onOpenDeal?.(d.id)} />
      ))}
    </div>
  );
}

function DealCard({
  deal,
  onClick,
}: {
  deal: ContactDealItem;
  onClick: () => void;
}) {
  const t = useTranslations('contacts.dealsTab');
  const isWon = !!deal.won_at;
  const isLost = !!deal.lost_at;
  const isOpen = !isWon && !isLost;

  const valueStr =
    deal.value > 0
      ? deal.value.toLocaleString('pt-BR', {
          style: 'currency',
          currency: deal.currency || 'BRL',
          maximumFractionDigits: 0,
        })
      : t('noValue');

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2 text-left transition-colors',
        'hover:border-primary/40 hover:bg-primary/5',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="truncate text-sm font-medium flex-1">{deal.title}</span>
        {isWon && (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500">
            <TrendingUp className="h-2.5 w-2.5" />
            {t('won')}
          </span>
        )}
        {isLost && (
          <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-500">
            <TrendingDown className="h-2.5 w-2.5" />
            {t('lost')}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold tabular-nums text-accent">{valueStr}</span>

        {deal.stage_name && (
          <span
            className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: `${deal.stage_color ?? '#6B7280'}20`,
              color: deal.stage_color ?? '#6B7280',
            }}
          >
            {deal.stage_name}
          </span>
        )}

        {isOpen && (
          <>
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              {t('score')}
              <AIScoreCircle score={deal.ai_score} size={20} />
            </span>
            {deal.ai_risk && <RiskPill risk={deal.ai_risk} />}
          </>
        )}
      </div>
    </button>
  );
}
