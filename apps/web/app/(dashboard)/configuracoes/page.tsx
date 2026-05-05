'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Bell,
  Bot,
  BotMessageSquare,
  Building2,
  Cable,
  CalendarClock,
  ChevronRight,
  Plug,
  Settings,
  Sliders,
  Sparkles,
  Tags as TagsIcon,
  Webhook as WebhookIcon,
  Workflow,
} from 'lucide-react';
import { settingsApi, type OrgSettings } from '@/lib/api/settings';
import { ApiError } from '@/lib/api/client';
import { OrgSection } from '@/components/configuracoes/org-section';
import { ChannelsSection } from '@/components/configuracoes/channels-section';
import { AiFeaturesSection } from '@/components/configuracoes/ai-features-section';
import { CustomFieldsAdminSection } from '@/components/configuracoes/custom-fields-section';
import { AutoLeadSection } from '@/components/configuracoes/auto-lead-section';
import { WebhooksSection } from '@/components/configuracoes/webhooks-section';
import { CalendarIntegrationsSection } from '@/components/configuracoes/calendar-integrations-section';
import { AppointmentTypesSection } from '@/components/configuracoes/appointment-types-section';
import { ConciergeSection } from '@/components/configuracoes/concierge-section';
import { ReEngagementSection } from '@/components/configuracoes/re-engagement-section';
import { TagsSection } from '@/components/configuracoes/tags-section';
import { AdIntegrationsSection } from '@/components/configuracoes/ad-integrations-section';
import { AdMetricsSection } from '@/components/configuracoes/ad-metrics-section';
import { IntelligenceSection } from '@/components/configuracoes/intelligence-section';
import { cn } from '@/lib/utils';

type Section =
  | 'org'
  | 'channels'
  | 'ai'
  | 'agente-ia'
  | 'concierge'
  | 'agenda'
  | 'custom-fields'
  | 'tags'
  | 'webhooks'
  | 'pipelines'
  | 'ad-integrations'
  | 'ad-metrics'
  | 'intelligence';

const SECTIONS: Array<{
  id: Section;
  label: string;
  icon: typeof Building2;
  description: string;
}> = [
  { id: 'org', label: 'Organização', icon: Building2, description: 'Nome, slug, plano' },
  { id: 'channels', label: 'Canais', icon: Cable, description: 'WhatsApp e outros' },
  { id: 'ai', label: 'Inteligência Artificial', icon: Bot, description: 'Features de IA' },
  {
    id: 'agente-ia',
    label: 'Agente de IA',
    icon: BotMessageSquare,
    description: 'Persona, horário, teste',
  },
  {
    id: 'concierge',
    label: 'Concierge IA',
    icon: Sparkles,
    description: 'Saudação + roteamento de leads',
  },
  {
    id: 'agenda',
    label: 'Agenda',
    icon: CalendarClock,
    description: 'Google Calendar, Calendly',
  },
  {
    id: 'custom-fields',
    label: 'Campos Personalizados',
    icon: Sliders,
    description: 'Deals, contatos, empresas',
  },
  {
    id: 'tags',
    label: 'Tags',
    icon: TagsIcon,
    description: 'Catálogo pra contatos e cards',
  },
  {
    id: 'webhooks',
    label: 'Webhooks',
    icon: WebhookIcon,
    description: 'Integrações externas (Zapier, n8n)',
  },
  { id: 'pipelines', label: 'Pipelines', icon: Workflow, description: 'Etapas e funis' },
  {
    id: 'ad-integrations',
    label: 'Integrações de Ads',
    icon: Plug,
    description: 'Meta Ads e Google Ads',
  },
  {
    id: 'ad-metrics',
    label: 'Métricas Monitoradas',
    icon: Activity,
    description: 'Catálogo + thresholds por org',
  },
  {
    id: 'intelligence',
    label: 'Inteligência (Alertas)',
    icon: Bell,
    description: 'Gestores, regras, sinais, entregas',
  },
];

export default function ConfiguracoesPage() {
  const [section, setSection] = useState<Section>('org');
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgError, setOrgError] = useState<string | null>(null);

  const reloadOrg = useCallback(async () => {
    setOrgError(null);
    try {
      const data = await settingsApi.getOrg();
      setOrg(data);
    } catch (err) {
      setOrgError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar organização',
      );
    } finally {
      setOrgLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadOrg();
  }, [reloadOrg]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-semibold">Configurações</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Gerencie organização, canais, IA e pipelines.
          </p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar de navegação interna */}
        <nav className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border bg-card/30 p-4 lg:flex">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = section === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <div className="flex flex-1 flex-col">
                  <span className="text-xs font-medium">{s.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {s.description}
                  </span>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Sidebar mobile (tabs horizontais) */}
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card/30 px-4 py-2 lg:hidden">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = section === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            );
          })}
        </nav>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
            {orgError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {orgError}
              </div>
            )}

            {section === 'org' && (
              <div className="flex flex-col gap-4">
                <OrgSection org={org} loading={orgLoading} onSaved={reloadOrg} />
                <AutoLeadSection org={org} onSaved={reloadOrg} />
              </div>
            )}

            {section === 'channels' && <ChannelsSection />}

            {section === 'ai' && <AiFeaturesSection />}

            {section === 'agenda' && (
              <div className="flex flex-col gap-4">
                <AppointmentTypesSection />
                <CalendarIntegrationsSection />
              </div>
            )}

            {section === 'agente-ia' && <AgenteIaLink />}

            {section === 'concierge' && (
              <div className="flex flex-col gap-4">
                <ConciergeSection org={org} onSaved={reloadOrg} />
                <ReEngagementSection />
              </div>
            )}

            {section === 'custom-fields' && <CustomFieldsAdminSection />}

            {section === 'tags' && <TagsSection />}

            {section === 'webhooks' && <WebhooksSection />}

            {section === 'pipelines' && <PipelinesLink />}

            {section === 'ad-integrations' && <AdIntegrationsSection />}

            {section === 'ad-metrics' && <AdMetricsSection />}

            {section === 'intelligence' && <IntelligenceSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelinesLink() {
  return (
    <Link
      href="/funis/configuracoes"
      className={cn(
        'group flex items-center gap-3 rounded-xl border border-border bg-card p-6 transition-colors',
        'hover:border-primary/30 hover:bg-accent/5',
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Workflow className="h-5 w-5" />
      </div>
      <div className="flex flex-1 flex-col">
        <span className="text-sm font-semibold">Configurar pipelines e etapas</span>
        <span className="text-xs text-muted-foreground">
          Reordene stages, ajuste cores, probabilidade e SLA.
        </span>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
    </Link>
  );
}

function AgenteIaLink() {
  return (
    <Link
      href="/configuracoes/agente-ia"
      className={cn(
        'group flex items-center gap-3 rounded-xl border border-border bg-card p-6 transition-colors',
        'hover:border-primary/30 hover:bg-accent/5',
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <BotMessageSquare className="h-5 w-5" />
      </div>
      <div className="flex flex-1 flex-col">
        <span className="text-sm font-semibold">Configurar Agente de IA</span>
        <span className="text-xs text-muted-foreground">
          Persona (nome, tom, diretrizes), horário comercial, modo teste e estatísticas.
        </span>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
    </Link>
  );
}
