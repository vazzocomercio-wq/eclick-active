'use client';

import { useState } from 'react';
import { Sparkles, Package, User as UserIcon, Tag, AlertCircle } from 'lucide-react';
import type { SacTicket } from '@/lib/api/sac';
import { sacApi } from '@/lib/api/sac';
import {
  PriorityBadge,
  StatusBadge,
  CategoryBadge,
  ReputationRiskBadge,
  sacLabels,
} from './sac-badges';
import { SlaCountdown } from './sla-countdown';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TicketDetailSideProps {
  ticket: SacTicket;
  onChanged?: () => void;
}

const PRIORITY_OPTIONS = Object.entries(sacLabels.priority);
const STATUS_OPTIONS = Object.entries(sacLabels.status);
const CATEGORY_OPTIONS = Object.entries(sacLabels.category);

export function TicketDetailSide({ ticket, onChanged }: TicketDetailSideProps) {
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(ticket.ai_suggested_response);

  const update = async (patch: Parameters<typeof sacApi.update>[1]) => {
    try {
      await sacApi.update(ticket.id, patch);
      onChanged?.();
    } catch {
      /* silent */
    }
  };

  const fetchSuggestion = async () => {
    setLoadingSuggest(true);
    try {
      const text = await sacApi.ai.suggest(ticket.id);
      setSuggestion(text);
    } finally {
      setLoadingSuggest(false);
    }
  };

  return (
    <aside className="flex w-full flex-col gap-3 overflow-y-auto border-l border-border bg-card/40 p-3 lg:w-[360px]">
      {/* Card Ticket */}
      <Card title="Ticket" icon={Tag}>
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono font-semibold">#{ticket.ticket_number}</span>
          {ticket.is_preventive && (
            <span className="rounded-sm bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-cyan-700 dark:text-cyan-300">
              Preventivo
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <CategoryBadge category={ticket.category} />
          <ReputationRiskBadge level={ticket.reputation_risk_level} />
        </div>

        <div className="mt-2 text-xs">
          <span className="text-muted-foreground">SLA: </span>
          <SlaCountdown deadline={ticket.sla_deadline_at} breached={ticket.sla_breached} />
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <SelectField
            label="Status"
            value={ticket.status}
            options={STATUS_OPTIONS}
            onChange={(v) => update({ status: v as SacTicket['status'] })}
          />
          <SelectField
            label="Prioridade"
            value={ticket.priority}
            options={PRIORITY_OPTIONS}
            onChange={(v) => update({ priority: v as SacTicket['priority'] })}
          />
          <SelectField
            label="Categoria"
            value={ticket.category}
            options={CATEGORY_OPTIONS}
            onChange={(v) => update({ category: v as SacTicket['category'] })}
          />
        </div>
      </Card>

      {/* Card IA */}
      <Card title="IA" icon={Sparkles} accent>
        {ticket.ai_summary ? (
          <p className="text-xs leading-relaxed text-foreground/80">{ticket.ai_summary}</p>
        ) : (
          <p className="text-xs italic text-muted-foreground">Ainda não classificado pela IA</p>
        )}

        {typeof ticket.ai_risk_score === 'number' && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Risk score</span>
              <span className="font-mono font-medium text-foreground">{ticket.ai_risk_score}/100</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full',
                  ticket.ai_risk_score > 70
                    ? 'bg-red-500'
                    : ticket.ai_risk_score > 40
                      ? 'bg-amber-500'
                      : 'bg-emerald-500',
                )}
                style={{ width: `${ticket.ai_risk_score}%` }}
              />
            </div>
          </div>
        )}

        {ticket.ai_resolution_suggestion && (
          <div className="mt-3 rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2 text-xs text-foreground/80">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
              Sugestão IA
            </div>
            {ticket.ai_resolution_suggestion}
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {suggestion ? (
            <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2 text-xs">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
                Resposta sugerida
              </div>
              <p className="leading-relaxed text-foreground/80">{suggestion}</p>
            </div>
          ) : null}
          <Button size="sm" variant="outline" onClick={fetchSuggestion} disabled={loadingSuggest}>
            <Sparkles className="h-3 w-3" />
            <span className="ml-1">{loadingSuggest ? 'Gerando…' : suggestion ? 'Regenerar' : 'Sugerir resposta'}</span>
          </Button>
        </div>
      </Card>

      {/* Card Pedido (se vinculado) */}
      {ticket.order_marketplace_id || ticket.order_data ? (
        <Card title="Pedido" icon={Package}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
            {ticket.order_marketplace && (
              <>
                <dt className="text-muted-foreground">Marketplace</dt>
                <dd className="font-medium">{ticket.order_marketplace}</dd>
              </>
            )}
            {ticket.order_marketplace_id && (
              <>
                <dt className="text-muted-foreground">Número</dt>
                <dd className="font-mono">{ticket.order_marketplace_id}</dd>
              </>
            )}
            {ticket.order_status && (
              <>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{ticket.order_status}</dd>
              </>
            )}
            {ticket.order_tracking && (
              <>
                <dt className="text-muted-foreground">Rastreio</dt>
                <dd className="font-mono">{ticket.order_tracking}</dd>
              </>
            )}
            {typeof ticket.order_value === 'number' && (
              <>
                <dt className="text-muted-foreground">Valor</dt>
                <dd className="font-medium">
                  {ticket.order_value.toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                </dd>
              </>
            )}
          </dl>
        </Card>
      ) : (
        <Card title="Pedido" icon={Package}>
          <p className="text-xs italic text-muted-foreground">
            Nenhum pedido vinculado. Use &quot;Vincular pedido&quot; pra buscar pelo SaaS.
          </p>
        </Card>
      )}

      {/* Card Contato */}
      <Card title="Contato" icon={UserIcon}>
        <p className="text-xs text-muted-foreground">
          ID: <span className="font-mono">{ticket.contact_id.slice(0, 8)}…</span>
        </p>
        <a
          href={`/contatos/${ticket.contact_id}`}
          className="mt-2 inline-block text-xs text-primary hover:underline"
        >
          Ver perfil completo →
        </a>
      </Card>

      {/* Card Resolução */}
      {ticket.status === 'resolved' && (
        <Card title="Resolução" icon={AlertCircle}>
          {ticket.resolution_type && (
            <p className="text-xs">
              <span className="text-muted-foreground">Tipo: </span>
              <span className="font-medium">{ticket.resolution_type}</span>
            </p>
          )}
          {ticket.resolution_notes && (
            <p className="mt-1 text-xs text-foreground/80">{ticket.resolution_notes}</p>
          )}
          {ticket.customer_satisfaction && (
            <p className="mt-2 text-xs">
              Satisfação: <span className="font-medium">{ticket.customer_satisfaction}/5 ⭐</span>
            </p>
          )}
        </Card>
      )}
    </aside>
  );
}

function Card({
  title,
  icon: Icon,
  accent,
  children,
}: {
  title: string;
  icon: typeof Sparkles;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-lg border bg-card p-3',
        accent ? 'border-cyan-500/30' : 'border-border',
      )}
    >
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
      >
        {options.map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}
