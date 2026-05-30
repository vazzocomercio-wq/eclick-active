'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Scissors,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import {
  cortesApi,
  CLIP_STATUS_ORDER,
  type BoardColumns,
  type CortesConfig,
} from '@/lib/api/studio-cortes';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { CortesBoard } from '@/components/cortes/cortes-board';
import { UploadDialog } from '@/components/cortes/upload-dialog';

const POLL_MS = 15000; // reconciliação (real-time fica pro Sprint 2)

const EMPTY_COLUMNS: BoardColumns = {
  a_revisar: [],
  aprovado: [],
  agendado: [],
  publicado: [],
  falhou: [],
};

export default function CortesPage() {
  const [config, setConfig] = useState<CortesConfig | null>(null);
  const [columns, setColumns] = useState<BoardColumns>(EMPTY_COLUMNS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [janitorRunning, setJanitorRunning] = useState(false);
  const firstLoad = useRef(true);

  const fetchBoard = useCallback(async () => {
    try {
      const res = await cortesApi.board();
      setColumns({ ...EMPTY_COLUMNS, ...res.columns });
      setError(null);
    } catch (err) {
      if (firstLoad.current) {
        setError(err instanceof ApiError ? err.message : String(err));
      }
    } finally {
      firstLoad.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cortesApi.config().then(setConfig).catch(() => {});
    void fetchBoard();
    const t = setInterval(() => void fetchBoard(), POLL_MS);
    return () => clearInterval(t);
  }, [fetchBoard]);

  async function runJanitor() {
    setJanitorRunning(true);
    try {
      const r = await cortesApi.runJanitor();
      toast.success(
        `Limpeza concluída — ${r.masters_deleted} master(s), ${r.workfiles_deleted} arquivo(s) de trabalho` +
          (r.quota_percent != null ? ` · Drive ${r.quota_percent}%` : ''),
      );
      void fetchBoard();
    } catch (err) {
      toast.error('Falha ao limpar', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setJanitorRunning(false);
    }
  }

  const total = CLIP_STATUS_ORDER.reduce((n, s) => n + (columns[s]?.length ?? 0), 0);
  const isEmpty = !loading && total === 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <Scissors className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Studio de Cortes</h1>
            <p className="text-xs text-muted-foreground">
              Vídeo longo vira cortes verticais prontos pra revisar
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void fetchBoard()}>
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="ml-1 hidden md:inline">Atualizar</span>
          </Button>
          <Button variant="outline" size="sm" onClick={runJanitor} disabled={janitorRunning}>
            {janitorRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            <span className="ml-1 hidden md:inline">Limpar Drive</span>
          </Button>
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <UploadCloud className="h-3.5 w-3.5" />
            <span className="ml-1">Enviar vídeo</span>
          </Button>
        </div>
      </header>

      {/* Avisos de configuração */}
      {config && (!config.drive_configured || !config.vizard_configured) && (
        <div className="flex flex-wrap gap-2 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2 md:px-6">
          {!config.drive_configured && (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Google Drive não configurado (GOOGLE_SA_KEY + CORTES_DRIVE_ID).
            </span>
          )}
          {!config.vizard_configured && (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Provedor de corte (VIZARD_API_KEY) não configurado.
            </span>
          )}
        </div>
      )}

      {/* Conteúdo */}
      <div className="flex-1 overflow-hidden p-4 md:p-6">
        {loading ? (
          <BoardSkeleton />
        ) : error ? (
          <div className="mx-auto mt-10 max-w-md rounded-xl border border-red-500/30 bg-red-500/5 p-5 text-center">
            <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchBoard()}>
              Tentar de novo
            </Button>
          </div>
        ) : isEmpty ? (
          <div className="mx-auto mt-12 max-w-md rounded-xl border border-dashed border-border p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Scissors className="h-6 w-6" />
            </div>
            <h2 className="text-sm font-semibold">Nenhum corte ainda</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Envie um vídeo longo (live, podcast, aula) e a IA gera os cortes verticais com
              legenda pronta pra Instagram, TikTok e YouTube.
            </p>
            <Button size="sm" className="mt-4" onClick={() => setUploadOpen(true)}>
              <UploadCloud className="h-3.5 w-3.5" />
              <span className="ml-1">Enviar primeiro vídeo</span>
            </Button>
          </div>
        ) : (
          <div className="h-full">
            <CortesBoard columns={columns} onRefresh={() => void fetchBoard()} />
          </div>
        )}
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={() => void fetchBoard()} />
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex h-full gap-3 overflow-hidden">
      {CLIP_STATUS_ORDER.map((s) => (
        <div key={s} className="flex w-[300px] shrink-0 flex-col rounded-xl border border-border bg-card">
          <div className="border-b border-border px-3 py-2.5">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          </div>
          <div className="flex flex-col gap-2 p-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-56 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
