'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  BarChart3,
  Check,
  Loader2,
  Plug,
  RefreshCw,
  Scissors,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  cortesApi,
  CLIP_STATUS_ORDER,
  type BoardColumns,
  type ClipPlatform,
  type ContentJob,
  type CortesConfig,
  type MetricsSummary,
} from '@/lib/api/studio-cortes';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { CortesBoard } from '@/components/cortes/cortes-board';
import { UploadDialog } from '@/components/cortes/upload-dialog';
import { JobsStrip } from '@/components/cortes/jobs-strip';

const POLL_MS = 15000; // reconciliação (real-time fica pro Sprint 2)

const PLATFORM_LABEL: Record<ClipPlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

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

  const [jobs, setJobs] = useState<ContentJob[]>([]);

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
    // jobs em andamento (visibilidade do pipeline) — best-effort
    void cortesApi.jobs().then(setJobs).catch(() => {});
  }, []);

  useEffect(() => {
    // Retorno do OAuth do Google (?google=connected|error)
    const params = new URLSearchParams(window.location.search);
    const g = params.get('google');
    if (g === 'connected') toast.success('Google Drive conectado! Já pode enviar vídeos.');
    else if (g === 'error') toast.error('Não consegui conectar o Google Drive. Tente de novo.');
    const yt = params.get('youtube');
    if (yt === 'connected') toast.success('Canal do YouTube conectado! Já dá pra escolher ele no corte.');
    else if (yt === 'error') toast.error('Não consegui conectar o canal do YouTube. Tente de novo.');
    const ig = params.get('instagram');
    if (ig === 'connected') {
      const n = params.get('count');
      toast.success(`Instagram conectado!${n ? ` ${n} conta(s) disponíveis no corte.` : ''}`);
    } else if (ig === 'error') {
      toast.error('Não consegui conectar o Instagram. Tente de novo.');
    }
    if (g || yt || ig) window.history.replaceState({}, '', '/social/cortes');

    void cortesApi.config().then(setConfig).catch(() => {});
    void fetchBoard();
    const t = setInterval(() => void fetchBoard(), POLL_MS);
    return () => clearInterval(t);
  }, [fetchBoard]);

  const [connecting, setConnecting] = useState(false);
  async function connectDrive() {
    setConnecting(true);
    try {
      const { url } = await cortesApi.googleConnect();
      window.location.href = url;
    } catch (err) {
      setConnecting(false);
      toast.error('Falha ao iniciar conexão', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    }
  }

  // Relatórios (Sprint 2)
  const [showMetrics, setShowMetrics] = useState(false);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  async function loadMetrics() {
    setMetricsLoading(true);
    try {
      setMetrics(await cortesApi.metrics());
    } catch {
      /* silencioso */
    } finally {
      setMetricsLoading(false);
    }
  }
  function toggleMetrics() {
    const next = !showMetrics;
    setShowMetrics(next);
    if (next && !metrics) void loadMetrics();
  }
  async function refreshMetrics() {
    setMetricsLoading(true);
    try {
      const r = await cortesApi.refreshMetrics();
      toast.success(`Métricas atualizadas (${r.updated} post(s)).`);
      setMetrics(await cortesApi.metrics());
    } catch (err) {
      toast.error('Falha ao atualizar métricas', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setMetricsLoading(false);
    }
  }

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
          <Button
            variant={showMetrics ? 'default' : 'outline'}
            size="sm"
            onClick={toggleMetrics}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="ml-1 hidden md:inline">Relatórios</span>
          </Button>
          <Button variant="outline" size="sm" onClick={runJanitor} disabled={janitorRunning}>
            {janitorRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            <span className="ml-1 hidden md:inline">Limpar Drive</span>
          </Button>
          {config && !config.drive_connected ? (
            <Button size="sm" onClick={connectDrive} disabled={connecting}>
              {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
              <span className="ml-1">Conectar Google Drive</span>
            </Button>
          ) : (
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <UploadCloud className="h-3.5 w-3.5" />
              <span className="ml-1">Enviar vídeo</span>
            </Button>
          )}
        </div>
      </header>

      {/* Status de conexão / avisos */}
      {config && !config.drive_connected && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/20 bg-cyan-500/5 px-4 py-2.5 md:px-6">
          <span className="inline-flex items-center gap-1.5 text-xs text-cyan-700 dark:text-cyan-300">
            <Plug className="h-3.5 w-3.5" />
            Conecte sua conta Google pra guardar os vídeos no seu Drive (usa seus 5TB).
          </span>
          <Button size="sm" variant="outline" onClick={connectDrive} disabled={connecting}>
            {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
            <span className="ml-1">Conectar Google Drive</span>
          </Button>
        </div>
      )}
      {config && config.drive_connected && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-1.5 md:px-6">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            Drive conectado{config.drive_email ? ` · ${config.drive_email}` : ''}
          </span>
          {!config.vizard_configured && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Provedor de corte (Vizard) não configurado — cortes não serão gerados.
            </span>
          )}
          {!config.youtube_ready && (
            <button
              onClick={connectDrive}
              className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 hover:underline dark:text-amber-300"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Reconecte o Drive pra publicar no YouTube (amplia o consentimento)
            </button>
          )}
        </div>
      )}

      {/* Relatórios (Sprint 2) */}
      {showMetrics && (
        <div className="border-b border-border bg-card/40 px-4 py-3 md:px-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Desempenho por plataforma</h2>
            <Button variant="outline" size="sm" onClick={refreshMetrics} disabled={metricsLoading}>
              {metricsLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span className="ml-1">Atualizar métricas</span>
            </Button>
          </div>
          {!metrics || metrics.by_platform.every((p) => p.posts === 0) ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum corte publicado ainda — os números aparecem aqui depois da primeira publicação.
            </p>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.by_platform.map((p) => ({ ...p, name: PLATFORM_LABEL[p.platform] }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip
                    contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#fafafa' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="views" name="Views" fill="#00E5FF" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="likes" name="Curtidas" fill="#4ADE50" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="comments" name="Comentários" fill="#a5f3fc" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Jobs em andamento (visibilidade do pipeline) */}
      <JobsStrip jobs={jobs} onRefresh={() => void fetchBoard()} />

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
