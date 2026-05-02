'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BarChart3, Bot, Clock, FlaskConical, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PersonaTab } from '@/components/configuracoes/agente-ia/persona-tab';
import { BusinessHoursTab } from '@/components/configuracoes/agente-ia/business-hours-tab';
import { TestModeTab } from '@/components/configuracoes/agente-ia/test-mode-tab';
import { StatsTab } from '@/components/configuracoes/agente-ia/stats-tab';

type Tab = 'persona' | 'hours' | 'test' | 'stats';

const TABS: Array<{ id: Tab; label: string; icon: typeof User; description: string }> = [
  { id: 'persona', label: 'Persona', icon: User, description: 'Identidade do agente' },
  { id: 'hours', label: 'Horário Comercial', icon: Clock, description: 'Quando responder' },
  { id: 'test', label: 'Modo Teste', icon: FlaskConical, description: 'Simular conversa' },
  { id: 'stats', label: 'Estatísticas', icon: BarChart3, description: 'Métricas de IA' },
];

export default function AgenteIaPage() {
  const [tab, setTab] = useState<Tab>('persona');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex flex-col gap-1">
          <Link
            href="/configuracoes"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Voltar para Configurações
          </Link>
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-semibold">Agente de IA</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Configure a persona, horário comercial, teste o agente e veja métricas.
          </p>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card/30 px-4 py-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="font-medium">{t.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
          {tab === 'persona' && <PersonaTab />}
          {tab === 'hours' && <BusinessHoursTab />}
          {tab === 'test' && <TestModeTab />}
          {tab === 'stats' && <StatsTab />}
        </div>
      </div>
    </div>
  );
}
