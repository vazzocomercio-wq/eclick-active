'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Loader2,
  RotateCcw,
  Scissors,
  Sparkles,
} from 'lucide-react';
import { cortesApi, type ContentJob, type JobStatus } from '@/lib/api/studio-cortes';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface JobsStripProps {
  jobs: ContentJob[];
  onRefresh: () => void;
}

const STAGE: Record<
  JobStatus,
  { label: string; hint: string; Icon: typeof Loader2; spin: boolean; tone: string }
> = {
  received: { label: 'Recebido', hint: 'no Drive', Icon: CloudUpload, spin: false, tone: 'text-muted-foreground' },
  fetching: { label: 'Baixando fonte', hint: '', Icon: Loader2, spin: true, tone: 'text-cyan-500' },
  clipping: { label: 'Cortando com IA', hint: 'pode levar alguns minutos', Icon: Scissors, spin: true, tone: 'text-cyan-500' },
  generating_copy: { label: 'Gerando legendas', hint: 'quase lá', Icon: Sparkles, spin: true, tone: 'text-cyan-500' },
  in_review: { label: 'Cortes prontos', hint: 'revise no board abaixo', Icon: CheckCircle2, spin: false, tone: 'text-emerald-500' },
  publishing: { label: 'Publicando', hint: '', Icon: Loader2, spin: true, tone: 'text-cyan-500' },
  done: { label: 'Concluído', hint: '', Icon: CheckCircle2, spin: false, tone: 'text-emerald-500' },
  failed: { label: 'Falhou', hint: '', Icon: AlertTriangle, spin: false, tone: 'text-red-500' },
};

export function JobsStrip({ jobs, onRefresh }: JobsStripProps) {
  // Mostra jobs ativos (não concluídos) + falhos recentes. 'done' some.
  const relevant = jobs.filter((j) => j.status !== 'done').slice(0, 6);
  if (relevant.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-card/40 px-4 py-3 md:px-6">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Em processamento
      </span>
      <div className="flex flex-wrap gap-2">
        {relevant.map((job) => (
          <JobChip key={job.id} job={job} onRefresh={onRefresh} />
        ))}
      </div>
    </div>
  );
}

function JobChip({ job, onRefresh }: { job: ContentJob; onRefresh: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const meta = STAGE[job.status];
  const Icon = meta.Icon;

  async function retry() {
    setRetrying(true);
    try {
      await cortesApi.retryClip(job.id);
      toast.success('Reenviado pra cortar — aguarde alguns minutos.');
      onRefresh();
    } catch (err) {
      toast.error('Falha ao reenviar', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-lg border bg-background px-3 py-2',
        job.status === 'failed' ? 'border-red-500/30' : 'border-border',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', meta.tone, meta.spin && 'animate-spin')} />
      <div className="min-w-0">
        <p className="max-w-[220px] truncate text-sm font-medium text-foreground">
          {job.title || 'Vídeo'}
        </p>
        <p className="text-[11px] text-muted-foreground">
          <span className={meta.tone}>{meta.label}</span>
          {job.status === 'failed' && job.failure_reason
            ? ` — ${job.failure_reason.slice(0, 60)}`
            : meta.hint
              ? ` · ${meta.hint}`
              : ''}
        </p>
      </div>
      {job.status === 'failed' && (
        <Button variant="outline" size="sm" className="ml-1 h-7" onClick={retry} disabled={retrying}>
          {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          <span className="ml-1">Tentar de novo</span>
        </Button>
      )}
    </div>
  );
}
