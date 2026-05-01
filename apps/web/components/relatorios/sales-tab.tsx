'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  CheckCircle,
  DollarSign,
  Percent,
  TrendingUp,
} from 'lucide-react';
import type { SalesReport } from '@/lib/api/reports';
import { cn } from '@/lib/utils';

interface SalesTabProps {
  data: SalesReport | null;
  loading: boolean;
}

export function SalesTab({ data, loading }: SalesTabProps) {
  if (loading || !data) {
    return <SkeletonGrid />;
  }

  const t = data.totals;

  return (
    <div className="flex flex-col gap-4">
      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          icon={DollarSign}
          color="bg-accent/10 text-accent"
          label="Receita total"
          value={formatBRL(t.revenue)}
          hint={t.avg_cycle_days !== null ? `Ciclo médio: ${t.avg_cycle_days}d` : ''}
        />
        <MetricCard
          icon={CheckCircle}
          color="bg-emerald-500/10 text-emerald-400"
          label="Deals ganhos"
          value={String(t.deals_won)}
          hint={`${t.deals_open} abertos`}
        />
        <MetricCard
          icon={TrendingUp}
          color="bg-primary/10 text-primary"
          label="Ticket médio"
          value={formatBRL(t.avg_ticket)}
        />
        <MetricCard
          icon={Percent}
          color="bg-yellow-500/10 text-yellow-400"
          label="Taxa de conversão"
          value={`${t.conversion_rate}%`}
          hint={`${t.deals_won} de ${t.deals_won + t.deals_lost} fechados`}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard title="Ganhos vs Perdidos por semana">
          {data.weekly_series.length === 0 ? (
            <EmptyChart message="Sem deals fechados no período" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.weekly_series}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="week_start"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v) => formatWeek(v)}
                />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="won"
                  fill="hsl(var(--accent))"
                  radius={[4, 4, 0, 0]}
                  name="Ganhos"
                />
                <Bar
                  dataKey="lost"
                  fill="hsl(var(--destructive))"
                  radius={[4, 4, 0, 0]}
                  name="Perdidos"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Receita acumulada">
          {data.revenue_cumulative.length === 0 ? (
            <EmptyChart message="Sem receita no período" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.revenue_cumulative}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v) => formatDay(v)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                  name="Receita"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Lost reasons */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <h2 className="text-sm font-semibold">Top motivos de perda</h2>
        </div>
        {data.lost_reasons.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma perda registrada no período. Mantenha assim 🎯
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.lost_reasons.map((r, i) => {
              const max = data.lost_reasons[0]?.count ?? 1;
              const pct = (r.count / max) * 100;
              return (
                <li key={i} className="flex items-center gap-3">
                  <span className="w-7 shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {r.count}
                  </span>
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="truncate text-xs">{r.reason}</span>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-destructive/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────

function MetricCard({
  icon: Icon,
  color,
  label,
  value,
  hint,
}: {
  icon: typeof DollarSign;
  color: string;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 animate-in fade-in slide-in-from-bottom-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className={cn('flex h-7 w-7 items-center justify-center rounded-md', color)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint && (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 animate-in fade-in">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="-mx-2">{children}</div>
    </section>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}

interface TooltipPayloadEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5" style={{ color: p.color }}>
          <span className="font-medium">{p.name}:</span>
          <span>{typeof p.value === 'number' ? formatTooltipValue(p.value, p.dataKey) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

function formatTooltipValue(v: number, dataKey: string | number | undefined): string {
  if (dataKey === 'revenue') return formatBRL(v);
  return v.toString();
}

function formatBRL(n: number): string {
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`;
  if (n >= 10_000) return `R$ ${(n / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}

function formatWeek(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function formatDay(iso: string): string {
  return formatWeek(iso);
}
