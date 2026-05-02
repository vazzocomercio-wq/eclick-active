'use client';

import { useState } from 'react';
import {
  ArrowRight,
  Calendar,
  DollarSign,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Loader2,
  Mail,
  Phone,
  Send,
  Sparkles,
  StickyNote,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import type { DealActivity, DealActivityType, Json } from '@eclick-active/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { dealsApi } from '@/lib/api/deals';
import { ApiError } from '@/lib/api/client';
import type { PipelineWithStages } from '@/lib/api/pipelines';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface DealHistoryTabProps {
  dealId: string;
  activities: DealActivity[];
  loading?: boolean;
  /** Pipeline + stages — usado pra resolver nomes/cores em stage_changed. */
  pipeline?: PipelineWithStages | null;
  /** Callback após nota ser adicionada (pra recarregar `activities`). */
  onActivityAdded?: () => void | Promise<void>;
}

/**
 * Aba "Histórico" — timeline de `deal_activities` ordenada DESC. Renderiza
 * ícone + título por tipo de atividade, com tratamento especial pra
 * `stage_changed` (mostra "Origem → Destino" com cores dos stages) e
 * `ai_insight` / atividades sem `created_by` (badge "IA"). Topo tem input
 * pra adicionar nota rápida.
 */
export function DealHistoryTab({
  dealId,
  activities,
  loading,
  pipeline,
  onActivityAdded,
}: DealHistoryTabProps) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const stagesById = new Map<string, { name: string; color: string }>();
  for (const s of pipeline?.stages ?? []) {
    stagesById.set(s.id, { name: s.name, color: s.color });
  }

  async function handleAddNote() {
    const text = note.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await dealsApi.addActivity(dealId, {
        activity_type: 'note_added',
        description: text,
      });
      setNote('');
      toast.success('Nota adicionada');
      await onActivityAdded?.();
    } catch (err) {
      toast.error('Falha ao adicionar nota', {
        description: err instanceof ApiError ? `${err.status}: ${err.message}` : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleAddNote();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Input de nota rápida */}
      <Card>
        <CardContent className="flex flex-col gap-2 p-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <StickyNote className="h-3 w-3" />
            Adicionar nota
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="O que aconteceu? Detalhes da última interação..."
            rows={2}
            disabled={submitting}
            className="min-h-[60px] resize-none text-sm"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              Ctrl+Enter envia
            </span>
            <Button
              size="sm"
              onClick={handleAddNote}
              disabled={!note.trim() || submitting}
              className="h-7"
            >
              {submitting ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3 w-3" />
              )}
              Salvar nota
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardContent className="flex flex-col gap-0 p-0">
          {loading ? (
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : activities.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              Sem atividades registradas ainda.
            </div>
          ) : (
            <ol className="flex flex-col">
              {activities.map((a, idx) => (
                <ActivityRow
                  key={a.id}
                  activity={a}
                  stagesById={stagesById}
                  isLast={idx === activities.length - 1}
                />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// ActivityRow
// ──────────────────────────────────────────────────────────

const ICON_MAP: Record<DealActivityType, typeof FileText> = {
  stage_changed: ArrowRight,
  value_changed: DollarSign,
  assigned: UserCheck,
  note_added: FileText,
  task_created: ListChecks,
  email_sent: Mail,
  call_made: Phone,
  meeting_scheduled: Calendar,
  proposal_sent: FileSpreadsheet,
  ai_insight: Sparkles,
};

const TITLE_MAP: Record<DealActivityType, string> = {
  stage_changed: 'Mudança de etapa',
  value_changed: 'Valor atualizado',
  assigned: 'Atribuição alterada',
  note_added: 'Nota interna',
  task_created: 'Tarefa criada',
  email_sent: 'Email enviado',
  call_made: 'Ligação registrada',
  meeting_scheduled: 'Reunião agendada',
  proposal_sent: 'Proposta enviada',
  ai_insight: 'Insight da IA',
};

interface ActivityRowProps {
  activity: DealActivity;
  stagesById: Map<string, { name: string; color: string }>;
  isLast: boolean;
}

function ActivityRow({ activity, stagesById, isLast }: ActivityRowProps) {
  const Icon = ICON_MAP[activity.activity_type] ?? FileText;
  const title = activity.title ?? TITLE_MAP[activity.activity_type];
  // `created_by IS NULL` indica origem sistema/IA (per shared types comment)
  const isAi = activity.activity_type === 'ai_insight' || activity.created_by === null;

  return (
    <li
      className={cn(
        'flex items-start gap-3 px-4 py-3',
        !isLast && 'border-b border-border',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          isAi ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>

      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{title}</span>
          {isAi && (
            <span className="inline-flex items-center gap-0.5 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-2.5 w-2.5" />
              IA
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {formatRelativeTime(activity.created_at)}
          </span>
        </div>

        <ActivityDetail activity={activity} stagesById={stagesById} />
      </div>
    </li>
  );
}

function ActivityDetail({
  activity,
  stagesById,
}: {
  activity: DealActivity;
  stagesById: Map<string, { name: string; color: string }>;
}) {
  // stage_changed — visual "Qualificado → Proposta" com cores
  if (activity.activity_type === 'stage_changed') {
    const meta = activity.metadata as Json as { from?: string; to?: string } | null;
    const from = meta?.from ? stagesById.get(meta.from) : null;
    const to = meta?.to ? stagesById.get(meta.to) : null;
    if (from || to) {
      return (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {from ? (
            <StagePill name={from.name} color={from.color} />
          ) : (
            <span className="text-muted-foreground italic">—</span>
          )}
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          {to ? (
            <StagePill name={to.name} color={to.color} />
          ) : (
            <span className="text-muted-foreground italic">—</span>
          )}
        </div>
      );
    }
  }

  // value_changed — mostra delta se metadata trouxer
  if (activity.activity_type === 'value_changed') {
    const meta = activity.metadata as Json as { from?: number; to?: number } | null;
    if (typeof meta?.from === 'number' && typeof meta?.to === 'number') {
      const delta = meta.to - meta.from;
      return (
        <p className="text-xs text-muted-foreground">
          {fmtBRL(meta.from)} → <span className="font-medium text-foreground">{fmtBRL(meta.to)}</span>
          <span
            className={cn(
              'ml-2 rounded-sm px-1 text-[10px] font-semibold tabular-nums',
              delta >= 0 ? 'bg-accent/15 text-accent' : 'bg-orange-500/15 text-orange-400',
            )}
          >
            {delta >= 0 ? '+' : ''}
            {fmtBRL(delta)}
          </span>
        </p>
      );
    }
  }

  // Default: descrição livre
  if (activity.description) {
    return (
      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
        {activity.description}
      </p>
    );
  }

  return null;
}

function StagePill({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: `${color}20`,
        color,
      }}
    >
      {name}
    </span>
  );
}

function fmtBRL(n: number): string {
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}
