'use client';

import { useMemo, useState } from 'react';
import { CheckSquare, ListTodo, Plus, RefreshCw } from 'lucide-react';
import type { TaskPriority, TaskType } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { useTasks } from '@/hooks/use-tasks';
import type { ListTasksParams } from '@/lib/api/tasks';
import { NewTaskDialog } from '@/components/tarefas/new-task-dialog';
import { TaskFilters, type StatusFilter } from '@/components/tarefas/task-filters';
import { TaskRowItem } from '@/components/tarefas/task-row';

export default function TarefasPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | null>(null);
  const [typeFilter, setTypeFilter] = useState<TaskType | null>(null);
  const [onlyMine, setOnlyMine] = useState(true);
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const params = useMemo<ListTasksParams>(() => {
    const p: ListTasksParams = {
      limit: 100,
      mine: onlyMine || undefined,
    };
    if (statusFilter === 'overdue') {
      p.only_overdue = true;
    } else if (statusFilter !== 'all') {
      p.status = statusFilter;
    }
    if (priorityFilter) p.priority = priorityFilter;
    if (typeFilter) p.task_type = typeFilter;
    return p;
  }, [statusFilter, priorityFilter, typeFilter, onlyMine]);

  const { data, loading, error, refetch, patchLocal, removeLocal } = useTasks(params);

  const tasks = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-semibold">Tarefas</h1>
            {!loading && (
              <span className="text-xs text-muted-foreground">
                · {total} {total === 1 ? 'tarefa' : 'tarefas'}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Suas atividades e follow-ups, criados por você ou sugeridos pela IA.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={() => setNewDialogOpen(true)}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Nova tarefa
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
          <TaskFilters
            statusFilter={statusFilter}
            priorityFilter={priorityFilter}
            typeFilter={typeFilter}
            onlyMine={onlyMine}
            onChangeStatus={setStatusFilter}
            onChangePriority={setPriorityFilter}
            onChangeType={setTypeFilter}
            onChangeMine={setOnlyMine}
          />

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {loading && !data ? (
            <SkeletonList />
          ) : tasks.length === 0 ? (
            <EmptyState onCreate={() => setNewDialogOpen(true)} />
          ) : (
            <ul className="flex flex-col gap-2">
              {tasks.map((t, idx) => (
                <li
                  key={t.id}
                  className="animate-in fade-in slide-in-from-bottom-1"
                  style={{ animationDelay: `${idx * 25}ms`, animationFillMode: 'backwards' }}
                >
                  <TaskRowItem
                    task={t}
                    onLocalPatch={patchLocal}
                    onLocalRemove={removeLocal}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <NewTaskDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onCreated={refetch}
      />
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <CheckSquare className="h-6 w-6" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Nenhuma tarefa por aqui</p>
        <p className="text-xs text-muted-foreground">
          Crie tarefas para acompanhar follow-ups, ligações e propostas.
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <Plus className="mr-2 h-3.5 w-3.5" />
        Criar primeira tarefa
      </Button>
    </div>
  );
}
