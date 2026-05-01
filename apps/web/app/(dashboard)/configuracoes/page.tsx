'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bot,
  Building2,
  Cable,
  ChevronRight,
  Settings,
  Workflow,
} from 'lucide-react';
import { settingsApi, type OrgSettings } from '@/lib/api/settings';
import { ApiError } from '@/lib/api/client';
import { OrgSection } from '@/components/configuracoes/org-section';
import { ChannelsSection } from '@/components/configuracoes/channels-section';
import { AiFeaturesSection } from '@/components/configuracoes/ai-features-section';
import { cn } from '@/lib/utils';

type Section = 'org' | 'channels' | 'ai' | 'pipelines';

const SECTIONS: Array<{
  id: Section;
  label: string;
  icon: typeof Building2;
  description: string;
}> = [
  { id: 'org', label: 'Organização', icon: Building2, description: 'Nome, slug, plano' },
  { id: 'channels', label: 'Canais', icon: Cable, description: 'WhatsApp e outros' },
  { id: 'ai', label: 'Inteligência Artificial', icon: Bot, description: 'Features de IA' },
  { id: 'pipelines', label: 'Pipelines', icon: Workflow, description: 'Etapas e funis' },
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
              <OrgSection org={org} loading={orgLoading} onSaved={reloadOrg} />
            )}

            {section === 'channels' && <ChannelsSection />}

            {section === 'ai' && <AiFeaturesSection />}

            {section === 'pipelines' && <PipelinesLink />}
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
