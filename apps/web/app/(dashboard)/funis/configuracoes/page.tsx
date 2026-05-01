'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Copy,
  Loader2,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  pipelinesApi,
  type PipelineWithStages,
} from '@/lib/api/pipelines';
import { ApiError } from '@/lib/api/client';
import { PipelineConfigSheet } from '@/components/funis/pipeline-config-sheet';
import { cn } from '@/lib/utils';

export default function PipelineSettingsPage() {
  const [pipelines, setPipelines] = useState<PipelineWithStages[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<PipelineWithStages | null>(null);

  // Form do "Novo pipeline"
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');

  const reload = useCallback(async () => {
    setError(null);
    try {
      const list = await pipelinesApi.list();
      setPipelines(list);
      // Mantém o pipeline editingPipeline atualizado se ainda existir
      setEditingPipeline((curr) =>
        curr ? list.find((p) => p.id === curr.id) ?? null : null,
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar pipelines',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCreatePipeline() {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await pipelinesApi.create({ name: newName.trim() });
      setNewName('');
      setShowNewForm(false);
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao criar pipeline',
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleDeletePipeline(id: string) {
    if (!confirm('Excluir esse pipeline? Essa ação é irreversível.')) return;
    setError(null);
    try {
      await pipelinesApi.remove(id);
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao excluir pipeline',
      );
    }
  }

  async function handleRenamePipeline(p: PipelineWithStages, name: string) {
    if (!name.trim() || name.trim() === p.name) return;
    setError(null);
    try {
      await pipelinesApi.update(p.id, { name: name.trim() });
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erro ao renomear',
      );
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex flex-col">
          <Link
            href="/funis"
            className="mb-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Voltar ao funil
          </Link>
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-semibold">Configurações de Pipelines</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Gerencie pipelines, etapas, cores, probabilidade e SLA.
          </p>
        </div>

        <Button size="sm" onClick={() => setShowNewForm((v) => !v)}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          Novo pipeline
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {showNewForm && (
            <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-card p-4">
              <h2 className="text-sm font-semibold">Novo pipeline</h2>
              <div className="flex flex-col gap-2">
                <Label className="text-xs">Nome</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Vendas B2B"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowNewForm(false);
                    setNewName('');
                  }}
                  disabled={creating}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreatePipeline}
                  disabled={creating || !newName.trim()}
                >
                  {creating && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Criar pipeline
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <SkeletonList />
          ) : pipelines.length === 0 ? (
            <EmptyState onCreate={() => setShowNewForm(true)} />
          ) : (
            <ul className="flex flex-col gap-3">
              {pipelines.map((p) => (
                <PipelineCard
                  key={p.id}
                  pipeline={p}
                  onConfigure={() => setEditingPipeline(p)}
                  onRename={(name) => handleRenamePipeline(p, name)}
                  onDelete={() => handleDeletePipeline(p.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <PipelineConfigSheet
        open={editingPipeline !== null}
        onOpenChange={(o) => !o && setEditingPipeline(null)}
        pipeline={editingPipeline}
        onChange={reload}
      />
    </div>
  );
}

function PipelineCard({
  pipeline,
  onConfigure,
  onRename,
  onDelete,
}: {
  pipeline: PipelineWithStages;
  onConfigure: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(pipeline.name);

  useEffect(() => setName(pipeline.name), [pipeline.name]);

  const totalDeals = pipeline.stages.reduce((acc, s) => acc + s.deal_count, 0);

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/30">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  if (name.trim() && name.trim() !== pipeline.name) {
                    onRename(name);
                  }
                  setEditingName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (name.trim() && name.trim() !== pipeline.name) onRename(name);
                    setEditingName(false);
                  }
                  if (e.key === 'Escape') {
                    setName(pipeline.name);
                    setEditingName(false);
                  }
                }}
                autoFocus
                className="text-base font-semibold"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="text-left text-base font-semibold transition-colors hover:text-primary"
            >
              {pipeline.name}
            </button>
          )}
          <span className="text-xs text-muted-foreground">
            {pipeline.stages.length} etapa{pipeline.stages.length === 1 ? '' : 's'} ·{' '}
            {totalDeals} deal{totalDeals === 1 ? '' : 's'}
            {pipeline.is_default && ' · padrão'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" disabled title="Em breve">
            <Copy className="mr-1 h-3.5 w-3.5" />
            Duplicar
          </Button>
          <Button variant="outline" size="sm" onClick={onConfigure}>
            <Settings className="mr-1 h-3.5 w-3.5" />
            Configurar etapas
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Mini-preview das stages com bolinhas coloridas */}
      <div className="flex flex-wrap items-center gap-1.5">
        {pipeline.stages.map((s) => (
          <span
            key={s.id}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px]',
              (s.is_won || s.is_lost) && 'opacity-60',
            )}
            title={`${s.probability}% · ${s.sla_hours ? `SLA ${s.sla_hours}h` : 'sem SLA'}`}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.name}
            {s.deal_count > 0 && (
              <span className="text-muted-foreground">·{s.deal_count}</span>
            )}
          </span>
        ))}
      </div>
    </li>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Settings className="h-6 w-6" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Nenhum pipeline configurado</p>
        <p className="text-xs text-muted-foreground">
          Crie seu primeiro pipeline para começar a organizar oportunidades.
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <Plus className="mr-2 h-3.5 w-3.5" />
        Criar pipeline
      </Button>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}
