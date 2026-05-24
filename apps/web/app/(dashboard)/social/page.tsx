'use client';

import Link from 'next/link';
import { Megaphone, Sparkles, Plus, Calendar, Image as ImageIcon, ChevronRight, BarChart3, GitCompareArrows, Rocket, SlidersHorizontal, Radio } from 'lucide-react';
import { useSocialDashboard, useContents, useBrands } from '@/hooks/use-social';
import { ContentCard } from '@/components/social/content-card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function SocialDashboardPage() {
  const { counts } = useSocialDashboard();
  const { brands } = useBrands();
  const { data: pending } = useContents({
    status: 'pending_approval',
    page_size: 6,
  });
  const { data: scheduled } = useContents({
    status: ['scheduled', 'approved'],
    page_size: 8,
  });

  const hasBrand = brands.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <Megaphone className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Social AI Studio</h1>
            <p className="text-xs text-muted-foreground">
              {hasBrand
                ? `${brands.length} marca${brands.length > 1 ? 's' : ''} ativa${brands.length > 1 ? 's' : ''}`
                : 'Configure sua marca pra começar'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/social/calendario">
              <Calendar className="h-3.5 w-3.5" />
              <span className="hidden md:inline ml-1">Calendário</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/social/biblioteca">
              <ImageIcon className="h-3.5 w-3.5" />
              <span className="hidden md:inline ml-1">Biblioteca</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/social/relatorios">
              <BarChart3 className="h-3.5 w-3.5" />
              <span className="hidden md:inline ml-1">Relatórios</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/social/campanhas">
              <Rocket className="h-3.5 w-3.5" />
              <span className="hidden md:inline ml-1">Campanhas</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/social/live">
              <Radio className="h-3.5 w-3.5" />
              <span className="hidden md:inline ml-1">Live</span>
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/social/automacao">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span className="hidden md:inline ml-1">Automação</span>
            </Link>
          </Button>
          {brands.length > 1 && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/social/comparativo">
                <GitCompareArrows className="h-3.5 w-3.5" />
                <span className="hidden md:inline ml-1">Comparativo</span>
              </Link>
            </Button>
          )}
          <Button size="sm" asChild>
            <Link href="/social/criar">
              <Sparkles className="h-3.5 w-3.5" />
              <span className="ml-1">Criar conteúdo</span>
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {!hasBrand && (
          <div className="mb-6 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-5">
            <h2 className="mb-2 text-sm font-semibold">Bem-vindo ao Social AI Studio 🎨</h2>
            <p className="text-sm text-foreground/80">
              O primeiro passo é configurar a identidade da sua marca. A IA usa
              isso pra gerar conteúdo na sua voz, com seu nicho e seus objetivos.
            </p>
            <Button size="sm" className="mt-3" asChild>
              <Link href="/social/marcas">
                <Plus className="h-3.5 w-3.5" />
                <span className="ml-1">Criar primeira marca</span>
              </Link>
            </Button>
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            label="Aguarda aprovação"
            value={counts?.pending_approval ?? 0}
            color="amber"
            href="/social/biblioteca?status=pending_approval"
          />
          <KpiCard
            label="Agendados (7d)"
            value={counts?.scheduled_next_7d ?? 0}
            color="blue"
            href="/social/calendario"
          />
          <KpiCard
            label="Publicados (mês)"
            value={counts?.published_this_month ?? 0}
            color="emerald"
          />
          <KpiCard
            label="Rascunhos"
            value={counts?.drafts ?? 0}
            color="slate"
            href="/social/biblioteca?status=draft"
          />
        </div>

        {/* Linha 2 — 2 colunas */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Próximos agendados — 2 cols */}
          <section className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Calendar className="h-4 w-4 text-primary" />
                Próximos agendados
              </h2>
              <Link
                href="/social/calendario"
                className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
              >
                Ver todos <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            {scheduled?.rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                Nenhum conteúdo agendado ainda
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {scheduled?.rows.map((c) => (
                  <ContentCard key={c.id} content={c} compact />
                ))}
              </div>
            )}
          </section>

          {/* Pendentes aprovação */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Aguardam aprovação
                {(counts?.pending_approval ?? 0) > 0 && (
                  <span className="rounded-full bg-amber-500/15 px-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    {counts?.pending_approval}
                  </span>
                )}
              </h2>
            </div>
            {pending?.rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                Nada pendente 🎯
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {pending?.rows.slice(0, 5).map((c) => (
                  <ContentCard key={c.id} content={c} compact />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: number;
  color: 'cyan' | 'amber' | 'blue' | 'emerald' | 'slate';
  href?: string;
}

function KpiCard({ label, value, color, href }: KpiCardProps) {
  const cls = {
    cyan: 'text-cyan-700 dark:text-cyan-300',
    amber: 'text-amber-700 dark:text-amber-300',
    blue: 'text-blue-700 dark:text-blue-300',
    emerald: 'text-emerald-700 dark:text-emerald-300',
    slate: 'text-slate-700 dark:text-slate-300',
  }[color];

  const inner = (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={cn('text-2xl font-semibold leading-tight', value > 0 && cls)}>
        {value}
      </span>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      {inner}
    </Link>
  ) : (
    inner
  );
}
