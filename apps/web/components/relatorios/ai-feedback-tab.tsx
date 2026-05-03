'use client';

import { useEffect, useState } from 'react';
import { MessageSquareQuote, ThumbsDown, ThumbsUp, TrendingUp } from 'lucide-react';
import { aiApi, type FeedbackStats } from '@/lib/api/ai';
import { ApiError } from '@/lib/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface AIFeedbackTabProps {
  /** Dias de janela. Default 30. */
  periodDays?: number;
}

/**
 * Aba "IA" do relatório — métricas de feedback 👍/👎 das respostas da IA
 * agregadas no período. Útil pra detectar regressões na qualidade dos
 * prompts/modelos e priorizar melhorias.
 */
export function AIFeedbackTab({ periodDays = 30 }: AIFeedbackTabProps) {
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    aiApi
      .getFeedbackStats(periodDays, ctrl.signal)
      .then(setStats)
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro ao carregar feedbacks',
        );
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [periodDays]);

  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!stats) return null;

  const total = stats.total_positive + stats.total_negative;
  const hasFeedback = total > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Cards de KPI */}
      <div className="grid gap-3 md:grid-cols-3">
        <KpiCard
          icon={ThumbsUp}
          tone="success"
          label="Feedbacks positivos"
          value={stats.total_positive}
          total={total}
        />
        <KpiCard
          icon={ThumbsDown}
          tone="danger"
          label="Feedbacks negativos"
          value={stats.total_negative}
          total={total}
        />
        <Card className={cn(!hasFeedback && 'opacity-60')}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-xs">
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
              Taxa de aprovação
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-3xl font-semibold tabular-nums">
              {hasFeedback ? `${stats.approval_rate}%` : '—'}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {hasFeedback
                ? `${stats.total_positive} de ${total} respostas foram úteis`
                : 'Sem feedback no período'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Donut visual + evolução semanal */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs">Distribuição</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center pt-0">
            {hasFeedback ? (
              <Donut positive={stats.total_positive} negative={stats.total_negative} />
            ) : (
              <p className="py-8 text-xs text-muted-foreground">Sem dados</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs">Aprovação por semana</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {stats.weekly.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">Sem dados</p>
            ) : (
              <WeeklyChart weekly={stats.weekly} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top 5 comentários negativos */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-xs">
            <MessageSquareQuote className="h-3.5 w-3.5 text-red-500" />
            Comentários negativos recentes
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {stats.recent_negative_comments.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Nenhum comentário negativo registrado no período.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {stats.recent_negative_comments.map((c, i) => (
                <li
                  key={`${c.at}-${i}`}
                  className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2"
                >
                  <p className="text-sm leading-snug">{c.comment}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(c.at).toLocaleString('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
  total,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: 'success' | 'danger';
  label: string;
  value: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const color = tone === 'success' ? 'text-emerald-500' : 'text-red-500';
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-xs">
          <Icon className={cn('h-3.5 w-3.5', color)} />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {total > 0 ? `${pct}% do total` : 'Sem feedback'}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Donut SVG simples — sem dependência externa. Aceita 2 valores e
 * desenha 2 arcos (positivo verde, negativo vermelho).
 */
function Donut({ positive, negative }: { positive: number; negative: number }) {
  const total = positive + negative;
  if (total === 0) return null;
  const positivePct = positive / total;
  const radius = 60;
  const stroke = 18;
  const circumference = 2 * Math.PI * radius;
  const positiveLen = positivePct * circumference;
  const negativeLen = circumference - positiveLen;

  return (
    <svg viewBox="0 0 160 160" className="h-40 w-40">
      {/* Track */}
      <circle
        cx="80"
        cy="80"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-muted"
      />
      {/* Positive arc (verde) — começa no topo */}
      <circle
        cx="80"
        cy="80"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeDasharray={`${positiveLen} ${negativeLen}`}
        strokeDashoffset={circumference / 4}
        transform="rotate(-90 80 80)"
        className="text-emerald-500"
      />
      <text
        x="80"
        y="76"
        textAnchor="middle"
        className="fill-foreground text-xl font-semibold"
      >
        {Math.round(positivePct * 100)}%
      </text>
      <text
        x="80"
        y="94"
        textAnchor="middle"
        className="fill-muted-foreground text-[10px]"
      >
        positivos
      </text>
    </svg>
  );
}

/**
 * Line chart inline (SVG) da taxa de aprovação por semana.
 */
function WeeklyChart({
  weekly,
}: {
  weekly: Array<{ week_start: string; positive: number; negative: number; approval_rate: number }>;
}) {
  if (weekly.length === 0) return null;
  const width = 360;
  const height = 120;
  const padX = 24;
  const padY = 16;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const stepX = weekly.length > 1 ? innerW / (weekly.length - 1) : 0;

  const points = weekly.map((w, i) => {
    const x = padX + i * stepX;
    const y = padY + (1 - w.approval_rate / 100) * innerH;
    return { x, y, w };
  });
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full">
      {/* Linha 50% pra referência */}
      <line
        x1={padX}
        x2={width - padX}
        y1={padY + innerH / 2}
        y2={padY + innerH / 2}
        stroke="currentColor"
        strokeDasharray="2 4"
        className="text-muted"
      />
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} className="text-primary" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} className="fill-primary" />
          <text
            x={p.x}
            y={height - 2}
            textAnchor="middle"
            className="fill-muted-foreground text-[8px]"
          >
            {formatWeek(p.w.week_start)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function formatWeek(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate().toString().padStart(2, '0')}/${(d.getUTCMonth() + 1).toString().padStart(2, '0')}`;
}
