'use client';

import { useState } from 'react';
import {
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Deal, DealRisk } from '@eclick-active/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { aiApi, type DealScoreFactors } from '@/lib/api/ai';
import { tasksApi, type CreateTaskInput } from '@/lib/api/tasks';
import { ApiError } from '@/lib/api/client';
import { FactorBar } from '@/components/funis/factor-bar';
import { AIScoreCircle } from '@/components/funis/ai-score-circle';
import { RiskPill } from '@/components/funis/risk-pill';
import { cn } from '@/lib/utils';

/**
 * Histórico de scores opcional. Se o backend persistir esse array em
 * `deal.custom_fields.score_history` (TODO no service), a aba renderiza
 * "Score subiu de X → Y (+Δ)". Caso contrário, esconde a seção.
 */
interface ScoreHistoryEntry {
  score: number;
  recorded_at: string;
}

interface CustomFieldsShape {
  ai_factors?: DealScoreFactors;
  /** Histórico opcional (mais antigo → mais novo). */
  score_history?: ScoreHistoryEntry[];
}

interface InsightsTabProps {
  detail: Deal | null;
  /** Disparado após mutação que altera o detail (rescore, criar task no deal). */
  onChanged?: () => void | Promise<void>;
  /** ID do usuário atual — pra `assigned_to` quando criar tarefa rápida. */
  currentUserId?: string | null;
}

/**
 * Aba "IA Insights" do Deal Detail Sheet — exibe score com breakdown,
 * risco, probabilidade de fechamento, próxima ação sugerida (com botão de
 * conversão em tarefa), histórico de score e botão de recálculo. Quando
 * o deal ainda não foi pontuado pela IA (`ai_score=0` e sem `ai_risk`),
 * mostra empty state com CTA "Calcular agora".
 */
export function DealInsightsTab({ detail, onChanged, currentUserId }: InsightsTabProps) {
  const [scoring, setScoring] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);

  if (!detail) return null;

  const customFields = (detail.custom_fields ?? {}) as CustomFieldsShape;
  const factors = customFields.ai_factors;
  const history = customFields.score_history ?? [];

  // Considera "não pontuado" quando score=0 + sem risco + sem fatores. Evita
  // mostrar empty state pra deals com score 0 legítimo (improvável mas possível).
  const isUnscored =
    detail.ai_score === 0 && detail.ai_risk === null && !factors;

  async function handleRescore() {
    setScoring(true);
    try {
      await aiApi.scoreDeal(detail!.id);
      toast.success('Score recalculado');
      await onChanged?.();
    } catch (err) {
      toast.error('Falha ao calcular score', { description: extractMessage(err) });
    } finally {
      setScoring(false);
    }
  }

  async function handleCreateTaskFromNextAction() {
    if (!detail!.ai_next_action || !currentUserId) return;
    setCreatingTask(true);
    try {
      const input: CreateTaskInput = {
        title: detail!.ai_next_action.slice(0, 200),
        assigned_to: detail!.assigned_to ?? currentUserId,
        deal_id: detail!.id,
        ...(detail!.contact_id ? { contact_id: detail!.contact_id } : {}),
        task_type: 'follow_up',
        priority: detail!.ai_risk === 'critical' || detail!.ai_risk === 'high' ? 'high' : 'normal',
        description: 'Sugerida pela IA a partir do score do deal',
      };
      await tasksApi.create(input);
      toast.success('Tarefa criada', {
        description: detail!.ai_next_action.slice(0, 80),
      });
      await onChanged?.();
    } catch (err) {
      toast.error('Falha ao criar tarefa', { description: extractMessage(err) });
    } finally {
      setCreatingTask(false);
    }
  }

  if (isUnscored) {
    return (
      <Card className="border-dashed border-primary/30 bg-primary/5">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Sparkles className="h-6 w-6" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Scoring não calculado</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              A IA ainda não analisou esse deal. Calcule agora pra ver score, risco
              e ação sugerida.
            </p>
          </div>
          <Button onClick={handleRescore} disabled={scoring}>
            {scoring ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-3.5 w-3.5" />
            )}
            Calcular agora
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Score header — círculo grande + risk + close prob + recalc */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="inline-flex items-center gap-1.5 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Insights IA
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRescore}
            disabled={scoring}
            className="h-7"
          >
            <RefreshCw className={cn('mr-1 h-3 w-3', scoring && 'animate-spin')} />
            Recalcular score
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <div className="flex items-center gap-4">
            <AIScoreCircle score={detail.ai_score} size={64} />

            <div className="flex flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Risco
                </span>
                <RiskPill risk={detail.ai_risk} />
              </div>
              {detail.ai_risk && (
                <p className="text-xs text-muted-foreground">{riskExplanation(detail.ai_risk)}</p>
              )}
            </div>

            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Prob. fechamento
              </span>
              <span className={cn(
                'text-3xl font-semibold tabular-nums leading-none',
                detail.ai_close_probability !== null && detail.ai_close_probability >= 70
                  ? 'text-accent'
                  : detail.ai_close_probability !== null && detail.ai_close_probability < 30
                    ? 'text-orange-400'
                    : 'text-foreground',
              )}>
                {detail.ai_close_probability ?? '—'}
                <span className="text-base text-muted-foreground">%</span>
              </span>
            </div>
          </div>

          {/* Histórico de scores */}
          {history.length >= 2 && <ScoreHistory history={history} currentScore={detail.ai_score} />}
        </CardContent>
      </Card>

      {/* Breakdown de fatores — 4 barras horizontais */}
      {factors && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs">Decomposição (0–25 cada)</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 pt-0">
            <FactorBar label="Engajamento" value={factors.engagement} />
            <FactorBar label="Recência" value={factors.recency} />
            <FactorBar label="Fit" value={factors.fit} />
            <FactorBar label="Intenção" value={factors.intent} />
          </CardContent>
          {factors.details && factors.details.length > 0 && (
            <CardContent className="border-t border-border pt-3">
              <ul className="flex flex-col gap-1.5">
                {factors.details.map((line, idx) => (
                  <li key={idx} className="flex items-start gap-1.5 text-[11px]">
                    <TrendingUp className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">{line}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}

      {/* Próxima ação sugerida */}
      {detail.ai_next_action && (
        <Card className="border-accent/30 bg-accent/5">
          <CardContent className="flex items-start gap-3 py-3">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                Próxima ação sugerida
              </span>
              <p className="text-sm leading-snug">{detail.ai_next_action}</p>
            </div>
            <Button
              size="sm"
              onClick={handleCreateTaskFromNextAction}
              disabled={creatingTask || !currentUserId}
              className="shrink-0 self-center"
            >
              {creatingTask ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-3.5 w-3.5" />
              )}
              Criar tarefa
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Score history — mostra última delta ("subiu de 45 → 72 (+27)")
// ──────────────────────────────────────────────────────────

function ScoreHistory({
  history,
  currentScore,
}: {
  history: ScoreHistoryEntry[];
  currentScore: number;
}) {
  // Pega o penúltimo (último é o atual). Se o array estiver fora de ordem,
  // ainda funciona — pegamos o mais recente que NÃO seja o currentScore.
  const sorted = [...history].sort(
    (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
  );
  const previous = sorted.find((entry) => entry.score !== currentScore) ?? sorted[1];
  if (!previous) return null;

  const delta = currentScore - previous.score;
  if (delta === 0) return null;

  const isUp = delta > 0;
  const Arrow = isUp ? TrendingUp : TrendingDown;

  return (
    <div className="flex items-center gap-2 rounded-md bg-background/60 px-3 py-2 text-xs">
      <Arrow
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          isUp ? 'text-accent' : 'text-orange-400',
        )}
      />
      <span className="text-muted-foreground">
        Score {isUp ? 'subiu' : 'caiu'} de{' '}
        <span className="font-medium text-foreground tabular-nums">{previous.score}</span>{' '}
        →{' '}
        <span className="font-medium text-foreground tabular-nums">{currentScore}</span>
      </span>
      <span
        className={cn(
          'ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
          isUp ? 'bg-accent/15 text-accent' : 'bg-orange-500/15 text-orange-400',
        )}
      >
        {isUp ? '+' : ''}
        {delta}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

const RISK_EXPLANATIONS: Record<DealRisk, string> = {
  low: 'Sinais positivos consistentes. Mantenha o ritmo de follow-up.',
  medium: 'Atenção redobrada. Pode estagnar sem ação proativa.',
  high: 'Risco real de perda. Próximos 7 dias são críticos.',
  critical: 'Conversão improvável sem mudança de estratégia.',
};

function riskExplanation(risk: DealRisk): string {
  return RISK_EXPLANATIONS[risk];
}

function extractMessage(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return 'Erro desconhecido';
}
