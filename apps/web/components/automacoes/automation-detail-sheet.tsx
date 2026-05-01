'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Edit,
  Loader2,
  Play,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  automationsApi,
  type Automation,
  type AutomationLog,
} from '@/lib/api/automations';
import { ApiError } from '@/lib/api/client';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  ActionIcon,
  TriggerBadge,
  actionLabel,
} from './automation-icons';

interface AutomationDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automation: Automation | null;
  onChanged: () => void;
  onEdit: (automation: Automation) => void;
}

export function AutomationDetailSheet({
  open,
  onOpenChange,
  automation,
  onChanged,
  onEdit,
}: AutomationDetailSheetProps) {
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'toggle' | 'test' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = useCallback(async () => {
    if (!automation) return;
    setLogsLoading(true);
    try {
      const result = await automationsApi.logs(automation.id);
      setLogs(result);
    } catch {
      // ignore
    } finally {
      setLogsLoading(false);
    }
  }, [automation]);

  useEffect(() => {
    if (open && automation) {
      void reload();
      setError(null);
      setConfirmDelete(false);
    }
  }, [open, automation, reload]);

  if (!automation) return null;

  async function handleToggle() {
    if (!automation) return;
    setBusy('toggle');
    try {
      await automationsApi.toggle(automation.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro');
    } finally {
      setBusy(null);
    }
  }

  async function handleTest() {
    if (!automation) return;
    setBusy('test');
    setError(null);
    try {
      const result = await automationsApi.test(automation.id);
      await reload();
      // Mostra um banner de status na próxima render
      setError(null);
      console.info('test result', result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro ao testar');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!automation) return;
    setBusy('delete');
    try {
      await automationsApi.remove(automation.id);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao deletar');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl" side="right">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>{automation.name}</SheetTitle>
          <SheetDescription>
            {automation.description ?? 'Sem descrição'}
            {automation.last_executed_at && (
              <>
                {' · '}última execução {formatRelativeTime(automation.last_executed_at)}
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {error && (
            <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* Trigger + actions snapshot */}
          <section className="flex flex-col gap-2 pb-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Disparador
            </h3>
            <TriggerBadge type={automation.trigger_type} />
          </section>

          <section className="flex flex-col gap-2 pb-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Ações ({automation.actions.length})
            </h3>
            <ol className="flex flex-col gap-1.5">
              {automation.actions.map((a, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-md border border-border bg-card/50 p-2"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums">
                    {i + 1}
                  </span>
                  <ActionIcon type={a.type} className="shrink-0" />
                  <span className="truncate text-xs">{actionLabel(a.type)}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Stats */}
          <section className="grid grid-cols-3 gap-2 pb-4">
            <Stat label="Execuções" value={String(automation.execution_count)} />
            <Stat label="Status" value={automation.is_active ? 'Ativa' : 'Pausada'} />
            <Stat
              label="Logs"
              value={String(logs.length)}
            />
          </section>

          {/* Timeline de execuções */}
          <section className="flex flex-col gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Últimas execuções
            </h3>

            {logsLoading ? (
              <div className="flex flex-col gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
                ))}
              </div>
            ) : logs.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Nenhuma execução registrada ainda. Use "Testar" pra rodar manualmente.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {logs.map((log) => (
                  <LogRow key={log.id} log={log} />
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          {confirmDelete ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-destructive">Excluir?</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDelete}
                disabled={busy === 'delete'}
              >
                {busy === 'delete' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Sim
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Não
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Excluir
            </Button>
          )}

          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={handleTest}
              disabled={busy !== null}
            >
              {busy === 'test' ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1 h-3.5 w-3.5" />
              )}
              Testar
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEdit(automation)}
              disabled={busy !== null}
            >
              <Edit className="mr-1 h-3.5 w-3.5" />
              Editar
            </Button>
            <Button
              size="sm"
              onClick={handleToggle}
              disabled={busy !== null}
              variant={automation.is_active ? 'outline' : 'default'}
            >
              {busy === 'toggle' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {automation.is_active ? 'Pausar' : 'Ativar'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LogRow({ log }: { log: AutomationLog }) {
  const Icon =
    log.status === 'success'
      ? CheckCircle2
      : log.status === 'partial'
        ? AlertCircle
        : XCircle;
  const color =
    log.status === 'success'
      ? 'text-emerald-400'
      : log.status === 'partial'
        ? 'text-yellow-400'
        : 'text-red-400';

  return (
    <li className="flex items-start gap-2 rounded-md border border-border bg-card/50 p-2.5">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', color)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-xs font-medium', color)}>
            {log.status === 'success'
              ? 'Sucesso'
              : log.status === 'partial'
                ? 'Parcial'
                : 'Falha'}
          </span>
          <span className="flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(log.created_at)}
            {log.duration_ms !== null && ` · ${log.duration_ms}ms`}
          </span>
        </div>
        {log.error && (
          <span className="text-[11px] text-destructive">{log.error}</span>
        )}
        <span className="text-[11px] text-muted-foreground">
          {log.actions_executed.length} ação(ões) ·{' '}
          {log.actions_executed.filter((a) => a.status === 'success').length} ok
          {log.actions_executed.some((a) => a.status === 'failed') &&
            `, ${log.actions_executed.filter((a) => a.status === 'failed').length} falha`}
        </span>
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-background/50 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}
