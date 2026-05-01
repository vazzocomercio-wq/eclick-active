'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  XCircle,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  automationsApi,
  type Automation,
} from '@/lib/api/automations';
import { ApiError } from '@/lib/api/client';
import { AiGenerateDialog } from '@/components/automacoes/ai-generate-dialog';
import { ManualBuilderDialog } from '@/components/automacoes/manual-builder-dialog';
import { AutomationDetailSheet } from '@/components/automacoes/automation-detail-sheet';
import {
  AUTOMATION_TEMPLATES,
  type AutomationTemplate,
} from '@/components/automacoes/templates';
import { TriggerBadge } from '@/components/automacoes/automation-icons';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function AutomacoesPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [aiOpen, setAiOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [selected, setSelected] = useState<Automation | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const list = await automationsApi.list();
      setAutomations(list);
      // Mantém o detail sheet sincronizado se a automação ainda existir
      setSelected((curr) =>
        curr ? list.find((a) => a.id === curr.id) ?? null : null,
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar automações',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function quickToggle(a: Automation, e: React.MouseEvent) {
    e.stopPropagation();
    setTogglingId(a.id);
    // Otimista
    setAutomations((curr) =>
      curr.map((x) => (x.id === a.id ? { ...x, is_active: !x.is_active } : x)),
    );
    try {
      await automationsApi.toggle(a.id);
    } catch {
      // Reverte
      setAutomations((curr) =>
        curr.map((x) => (x.id === a.id ? { ...x, is_active: a.is_active } : x)),
      );
    } finally {
      setTogglingId(null);
    }
  }

  async function applyTemplate(t: AutomationTemplate) {
    setError(null);
    try {
      await automationsApi.create(t.build());
      void reload();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao criar template',
      );
    }
  }

  const activeCount = automations.filter((a) => a.is_active).length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-semibold">Automações</h1>
            {!loading && (
              <span className="text-xs text-muted-foreground">
                · {activeCount}/{automations.length}{' '}
                {automations.length === 1 ? 'ativa' : 'ativas'}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Fluxos disparados automaticamente por eventos do CRM.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing(null);
              setManualOpen(true);
            }}
          >
            <Plus className="mr-2 h-3.5 w-3.5" />
            Nova automação
          </Button>
          <Button
            size="sm"
            onClick={() => setAiOpen(true)}
            className="bg-primary text-primary-foreground"
          >
            <Sparkles className="mr-2 h-3.5 w-3.5" />
            Criar com IA
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {loading && automations.length === 0 ? (
            <SkeletonList />
          ) : automations.length === 0 ? (
            <>
              <EmptyState
                onAi={() => setAiOpen(true)}
                onManual={() => {
                  setEditing(null);
                  setManualOpen(true);
                }}
              />
              <TemplatesSection onApply={(t) => void applyTemplate(t)} />
            </>
          ) : (
            <ul className="flex flex-col gap-2">
              {automations.map((a, idx) => (
                <li
                  key={a.id}
                  className="animate-in fade-in slide-in-from-bottom-1"
                  style={{ animationDelay: `${idx * 25}ms`, animationFillMode: 'backwards' }}
                >
                  <AutomationCard
                    automation={a}
                    onSelect={() => setSelected(a)}
                    onToggle={(e) => void quickToggle(a, e)}
                    toggling={togglingId === a.id}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <AiGenerateDialog open={aiOpen} onOpenChange={setAiOpen} onCreated={reload} />
      <ManualBuilderDialog
        open={manualOpen}
        onOpenChange={(o) => {
          setManualOpen(o);
          if (!o) setEditing(null);
        }}
        existing={editing}
        onSaved={reload}
      />
      <AutomationDetailSheet
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
        automation={selected}
        onChanged={reload}
        onEdit={(a) => {
          setSelected(null);
          setEditing(a);
          setManualOpen(true);
        }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// AutomationCard
// ──────────────────────────────────────────────────────────

function AutomationCard({
  automation,
  onSelect,
  onToggle,
  toggling,
}: {
  automation: Automation;
  onSelect: () => void;
  onToggle: (e: React.MouseEvent) => void;
  toggling: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all',
        'hover:border-primary/30 hover:shadow-sm',
        !automation.is_active && 'opacity-70',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{automation.name}</span>
          {automation.natural_language_source && (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              <Sparkles className="h-3 w-3" />
              IA
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TriggerBadge type={automation.trigger_type} />
          <span className="text-[11px] text-muted-foreground">
            {automation.actions.length} ação{automation.actions.length === 1 ? '' : 'ões'} · {automation.execution_count} execução{automation.execution_count === 1 ? '' : 'ões'}
          </span>
          {automation.last_executed_at && (
            <span className="text-[11px] text-muted-foreground">
              · última {formatRelativeTime(automation.last_executed_at)}
            </span>
          )}
        </div>
      </div>

      {/* Toggle switch */}
      <span
        role="switch"
        aria-checked={automation.is_active}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle(e as unknown as React.MouseEvent);
          }
        }}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors',
          automation.is_active ? 'bg-primary' : 'bg-muted',
          toggling && 'opacity-50',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform',
            automation.is_active && 'translate-x-4',
          )}
        />
      </span>
    </button>
  );
}

// ──────────────────────────────────────────────────────────
// Empty + Templates
// ──────────────────────────────────────────────────────────

function EmptyState({
  onAi,
  onManual,
}: {
  onAi: () => void;
  onManual: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Zap className="h-6 w-6" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Sem automações ainda</p>
        <p className="text-xs text-muted-foreground">
          Crie a primeira em segundos descrevendo em português, ou comece de um template abaixo.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onAi}>
          <Sparkles className="mr-2 h-3.5 w-3.5" />
          Criar com IA
        </Button>
        <Button variant="outline" size="sm" onClick={onManual}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          Manual
        </Button>
      </div>
    </div>
  );
}

function TemplatesSection({ onApply }: { onApply: (t: AutomationTemplate) => void }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Templates prontos
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {AUTOMATION_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onApply(t)}
            className={cn(
              'flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4 text-left transition-all',
              'hover:border-primary/30 hover:shadow-sm',
            )}
          >
            <span className="text-sm font-semibold">{t.name}</span>
            <span className="text-[11px] text-muted-foreground">{t.description}</span>
            <span className="mt-1 truncate text-[10px] italic text-muted-foreground/80">
              {t.example}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}
