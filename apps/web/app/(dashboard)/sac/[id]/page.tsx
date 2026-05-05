'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, ArrowUp, RotateCw, Link as LinkIcon } from 'lucide-react';
import { useSacTicket } from '@/hooks/use-sac';
import { sacApi } from '@/lib/api/sac';
import type { SacResolutionType } from '@/lib/api/sac';
import { TicketDetailSide } from '@/components/sac/ticket-detail-side';
import { TicketTimeline } from '@/components/sac/ticket-timeline';
import { Button } from '@/components/ui/button';

const RESOLUTION_OPTIONS: Array<[SacResolutionType, string]> = [
  ['resolved', 'Resolvido'],
  ['refunded', 'Reembolsado'],
  ['exchanged', 'Trocado'],
  ['returned', 'Devolvido'],
  ['cancelled', 'Cancelado'],
  ['escalated', 'Escalado externamente'],
  ['no_action_needed', 'Sem ação necessária'],
  ['duplicate', 'Duplicado'],
];

export default function SacDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? null;
  const { ticket, actions, loading, refresh } = useSacTicket(id);

  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolutionType, setResolutionType] = useState<SacResolutionType>('resolved');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [linkQuery, setLinkQuery] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading && !ticket) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Carregando ticket…
      </div>
    );
  }
  if (!ticket) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        Ticket não encontrado
        <Button variant="outline" size="sm" onClick={() => router.push('/sac')}>
          Voltar ao SAC
        </Button>
      </div>
    );
  }

  const submitResolve = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await sacApi.resolve(id, {
        resolution_type: resolutionType,
        resolution_notes: resolutionNotes || undefined,
      });
      setResolveOpen(false);
      setResolutionNotes('');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const submitReopen = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await sacApi.reopen(id);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const submitLink = async () => {
    if (!id || !linkQuery.trim()) return;
    setBusy(true);
    try {
      await sacApi.linkOrder(id, linkQuery.trim());
      setLinkOpen(false);
      setLinkQuery('');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/sac')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="flex-1 truncate text-sm font-semibold">
          Ticket #{ticket.ticket_number} —{' '}
          <span className="text-muted-foreground">{ticket.ai_summary ?? 'Sem resumo'}</span>
        </h1>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLinkOpen(true)}
          >
            <LinkIcon className="h-3.5 w-3.5" />
            <span className="hidden md:inline ml-1">Vincular pedido</span>
          </Button>
          {ticket.status === 'resolved' ? (
            <Button variant="outline" size="sm" onClick={submitReopen} disabled={busy}>
              <RotateCw className="h-3.5 w-3.5" />
              <span className="hidden md:inline ml-1">Reabrir</span>
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => setResolveOpen(true)}
              disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="hidden md:inline ml-1">Resolver</span>
            </Button>
          )}
          <Button variant="outline" size="sm" disabled>
            <ArrowUp className="h-3.5 w-3.5" />
            <span className="hidden md:inline ml-1">Escalar</span>
          </Button>
        </div>
      </header>

      {/* Layout 2 colunas */}
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Esquerda — timeline + (futuramente) chat */}
        <div className="flex-1 overflow-y-auto p-4">
          {ticket.conversation_id ? (
            <div className="mb-4 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs">
              Esta conversa tem{' '}
              <a
                href={`/conversas?conversation=${ticket.conversation_id}`}
                className="font-medium text-cyan-700 underline dark:text-cyan-300"
              >
                histórico no chat ↗
              </a>
            </div>
          ) : null}

          <h2 className="mb-3 text-sm font-semibold">Timeline</h2>
          <TicketTimeline actions={actions} />
        </div>

        {/* Direita */}
        <TicketDetailSide ticket={ticket} onChanged={refresh} />
      </div>

      {/* Dialog Resolver */}
      {resolveOpen && (
        <Modal title="Resolver ticket" onClose={() => setResolveOpen(false)}>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Tipo de resolução</span>
            <select
              value={resolutionType}
              onChange={(e) => setResolutionType(e.target.value as SacResolutionType)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              {RESOLUTION_OPTIONS.map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="mt-3 flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Notas (opcional)</span>
            <textarea
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              className="rounded-md border border-border bg-background p-2 text-sm"
              rows={3}
              placeholder="O que foi feito?"
            />
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setResolveOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={submitResolve} disabled={busy}>
              {busy ? 'Salvando…' : 'Confirmar'}
            </Button>
          </div>
        </Modal>
      )}

      {/* Dialog Vincular pedido */}
      {linkOpen && (
        <Modal title="Vincular pedido do SaaS" onClose={() => setLinkOpen(false)}>
          <p className="text-xs text-muted-foreground">
            Cole o número do pedido (marketplace_order_id) ou rastreio
          </p>
          <input
            value={linkQuery}
            onChange={(e) => setLinkQuery(e.target.value)}
            placeholder="ML-123456789 ou BR123456789BR"
            className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setLinkOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={submitLink} disabled={busy || !linkQuery.trim()}>
              {busy ? 'Buscando…' : 'Vincular'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}
