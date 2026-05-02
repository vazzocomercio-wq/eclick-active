'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Copy,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  pipelinesApi,
  type PipelineWithStages,
} from '@/lib/api/pipelines';
import { ApiError } from '@/lib/api/client';
import { PipelineConfigSheet } from '@/components/funis/pipeline-config-sheet';
import { NewPipelineDialog } from '@/components/funis/new-pipeline-dialog';
import { cn } from '@/lib/utils';

export default function PipelineSettingsPage() {
  const [pipelines, setPipelines] = useState<PipelineWithStages[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingPipeline, setEditingPipeline] = useState<PipelineWithStages | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      // Em /configuracoes, lista TUDO (inclui arquivados pra restore)
      const list = await pipelinesApi.list({ includeArchived: true });
      setPipelines(list);
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

  async function handleArchive(p: PipelineWithStages) {
    if (!confirm(`Arquivar "${p.name}"? Não aparece no board, dados ficam preservados.`)) {
      return;
    }
    try {
      await pipelinesApi.archive(p.id);
      toast.success('Pipeline arquivado');
      await reload();
    } catch (err) {
      toast.error('Falha ao arquivar', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    }
  }

  async function handleRestore(p: PipelineWithStages) {
    try {
      await pipelinesApi.restore(p.id);
      toast.success('Pipeline restaurado');
      await reload();
    } catch (err) {
      toast.error('Falha ao restaurar', {
        description: err instanceof ApiError ? err.message : String(err),
      });
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

        <Button size="sm" onClick={() => setNewDialogOpen(true)}>
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

          {loading ? (
            <SkeletonList />
          ) : pipelines.length === 0 ? (
            <EmptyState onCreate={() => setNewDialogOpen(true)} />
          ) : (
            <ul className="flex flex-col gap-3">
              {pipelines.map((p) => (
                <PipelineCard
                  key={p.id}
                  pipeline={p}
                  onConfigure={() => setEditingPipeline(p)}
                  onRename={(name) => handleRenamePipeline(p, name)}
                  onDelete={() => handleDeletePipeline(p.id)}
                  onArchive={() => void handleArchive(p)}
                  onRestore={() => void handleRestore(p)}
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

      <NewPipelineDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onCreated={() => void reload()}
      />
    </div>
  );
}

function PipelineCard({
  pipeline,
  onConfigure,
  onRename,
  onDelete,
  onArchive,
  onRestore,
}: {
  pipeline: PipelineWithStages;
  onConfigure: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(pipeline.name);

  useEffect(() => setName(pipeline.name), [pipeline.name]);

  const totalDeals = pipeline.stages.reduce((acc, s) => acc + s.deal_count, 0);
  const isArchived = !!pipeline.archived_at;

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-5 transition-colors',
        isArchived
          ? 'border-border/50 opacity-70 hover:opacity-100'
          : 'border-border hover:border-primary/30',
      )}
    >
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
              {isArchived && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Archive className="h-2.5 w-2.5" />
                  Arquivado
                </span>
              )}
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
          {isArchived ? (
            <Button variant="outline" size="sm" onClick={onRestore}>
              <ArchiveRestore className="mr-1 h-3.5 w-3.5" />
              Restaurar
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={onArchive}
              title="Arquivar pipeline"
            >
              <Archive className="h-3.5 w-3.5" />
            </Button>
          )}
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
