'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  Megaphone,
  Sparkles,
  AlertTriangle,
  TrendingUp,
  Calendar as CalIcon,
  ExternalLink,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface OrgWithSummary {
  org_id: string;
  org_name: string;
  user_role: string;
  social: {
    pending_approval: number;
    scheduled_next_7d: number;
    drafts: number;
    published_this_month: number;
    total_brands: number;
  };
  unread_signals: number;
}

/**
 * Dashboard de agência matriz: usuário com membership em N orgs vê
 * panorama de cada uma. Útil pra agências que gerenciam múltiplos
 * clientes — saber rapidamente onde tem coisa pendente.
 */
export default function AgencyDashboardPage() {
  const [orgs, setOrgs] = useState<OrgWithSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.get<OrgWithSummary[]>('/agency/dashboard');
        setOrgs(list);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalPending = orgs.reduce((s, o) => s + o.social.pending_approval, 0);
  const totalSignals = orgs.reduce((s, o) => s + o.unread_signals, 0);
  const totalScheduled = orgs.reduce((s, o) => s + o.social.scheduled_next_7d, 0);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Building2 className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Visão de agência</h1>
            <p className="text-xs text-muted-foreground">
              {orgs.length} organização(ões) sob sua gestão
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : orgs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <Building2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Você é membro de apenas uma organização. A visão de agência aparece
              quando você gerencia 2+ orgs.
            </p>
          </div>
        ) : orgs.length === 1 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <Building2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Você é membro de apenas {orgs[0]?.org_name ?? 'uma organização'}.
              Visão de agência mostra dados consolidados quando há 2+ orgs.
            </p>
          </div>
        ) : (
          <>
            {/* KPIs agregados de TODAS as orgs */}
            <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi
                label="Orgs gerenciadas"
                value={orgs.length}
                icon={Building2}
                color="cyan"
              />
              <Kpi
                label="Pendentes aprovação"
                value={totalPending}
                icon={Sparkles}
                color="amber"
                pulse={totalPending > 0}
              />
              <Kpi
                label="Agendados (7d)"
                value={totalScheduled}
                icon={CalIcon}
                color="blue"
              />
              <Kpi
                label="Signals não lidos"
                value={totalSignals}
                icon={AlertTriangle}
                color="red"
                pulse={totalSignals > 0}
              />
            </section>

            {/* Cards das orgs */}
            <section>
              <h2 className="mb-3 text-sm font-semibold">
                Organizações ({orgs.length})
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {orgs.map((o) => (
                  <OrgCard key={o.org_id} org={o} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  color,
  pulse,
}: {
  label: string;
  value: number;
  icon: typeof Building2;
  color: 'cyan' | 'amber' | 'blue' | 'red';
  pulse?: boolean;
}) {
  const cls = {
    cyan: 'text-cyan-700 dark:text-cyan-300',
    amber: 'text-amber-700 dark:text-amber-300',
    blue: 'text-blue-700 dark:text-blue-300',
    red: 'text-red-700 dark:text-red-300',
  }[color];

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border bg-card p-3',
        pulse && value > 0 && 'animate-pulse',
      )}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <span className={cn('text-2xl font-semibold leading-tight', value > 0 && cls)}>
        {value}
      </span>
    </div>
  );
}

function OrgCard({ org }: { org: OrgWithSummary }) {
  const hasAlerts = org.social.pending_approval > 0 || org.unread_signals > 0;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-4',
        hasAlerts ? 'border-amber-500/40' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-cyan-400 text-sm font-bold text-white">
            {org.org_name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-semibold">{org.org_name}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {org.user_role} · {org.social.total_brands} marca(s)
            </p>
          </div>
        </div>
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat
          icon={Sparkles}
          label="Pendentes"
          value={org.social.pending_approval}
          highlight={org.social.pending_approval > 0}
          color="amber"
        />
        <Stat
          icon={CalIcon}
          label="Agendados"
          value={org.social.scheduled_next_7d}
          color="blue"
        />
        <Stat
          icon={TrendingUp}
          label="Publicados"
          value={org.social.published_this_month}
          color="emerald"
        />
      </div>

      {org.unread_signals > 0 && (
        <div className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-700 dark:text-red-300">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {org.unread_signals} signal(s) não lido(s)
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-t border-border/40 pt-2">
        <ActionLink href={`/social?org=${org.org_id}`} label="Social AI" icon={Megaphone} />
        <ActionLink
          href={`/social/relatorios?org=${org.org_id}`}
          label="Relatórios"
          icon={TrendingUp}
        />
        <ActionLink href="/" label="Dashboard" icon={Building2} />
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  highlight,
  color,
}: {
  icon: typeof Building2;
  label: string;
  value: number;
  highlight?: boolean;
  color: 'amber' | 'blue' | 'emerald';
}) {
  const cls = {
    amber: highlight ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
    blue: 'text-blue-600 dark:text-blue-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
  }[color];
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2">
      <div className="flex items-center justify-center gap-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-2.5 w-2.5" />
        {label}
      </div>
      <p className={cn('mt-0.5 text-sm font-semibold', value > 0 && cls)}>{value}</p>
    </div>
  );
}

function ActionLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof Building2;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] hover:bg-muted"
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </Link>
  );
}
