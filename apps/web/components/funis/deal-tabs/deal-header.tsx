'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  MoreVertical,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Deal } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { TemperatureBadge } from '@/components/contacts/temperature-badge';
import { AIScoreCircle } from '@/components/funis/ai-score-circle';
import { RiskPill } from '@/components/funis/risk-pill';
import { dealsApi, type UpdateDealInput } from '@/lib/api/deals';
import { ApiError } from '@/lib/api/client';
import type { PipelineWithStages } from '@/lib/api/pipelines';
import { cn } from '@/lib/utils';

interface DealHeaderProps {
  deal: Deal & {
    contact?: { temperature?: 'cold' | 'warm' | 'hot' | 'very_hot' | null } | null;
  };
  pipeline: PipelineWithStages | null;
  onChanged: () => void | Promise<void>;
  onMoveToLost: () => void;
  onMoveToWon: () => void;
  onDelete: () => void | Promise<void>;
  saving: boolean;
  deleting: boolean;
}

/**
 * Header fixo do Deal Detail Sheet — fica acima das abas e tem:
 *  - Número do deal: "Negócio #ABC1" (últimos 4 chars do UUID em uppercase)
 *  - Título com inline-edit (click → input, blur/Enter salva, Esc cancela)
 *  - Valor com inline-edit (formatado R$ na exibição, decimal no edit)
 *  - Stage como dropdown colorido (mover dispara POST /deals/:id/move)
 *  - Badges: AI score circle, Risk pill, Temperature
 *  - Ações: Ganho (verde), Perdido (vermelho), menu ⋯ (excluir)
 */
export function DealHeader({
  deal,
  pipeline,
  onChanged,
  onMoveToLost,
  onMoveToWon,
  onDelete,
  saving,
  deleting,
}: DealHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click fora pra fechar menu ⋯
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const isWon = deal.won_at !== null;
  const isLost = deal.lost_at !== null;
  const isClosed = isWon || isLost;
  // Usa deal_number quando disponível (migration 009 backfill cobre legacy);
  // mantém fallback aos últimos 4 chars do UUID pra deals nunca vistos
  // antes da migration rodar (defensive — type-system requer number).
  const dealNumber = deal.deal_number
    ? String(deal.deal_number)
    : deal.id.slice(-4).toUpperCase();
  const currentStage = pipeline?.stages.find((s) => s.id === deal.stage_id) ?? null;

  async function handleMoveStage(stageId: string) {
    if (stageId === deal.stage_id) return;
    const target = pipeline?.stages.find((s) => s.id === stageId);
    if (target?.is_lost) {
      onMoveToLost();
      return;
    }
    try {
      await dealsApi.move(deal.id, { stage_id: stageId });
      await onChanged();
      toast.success(target?.is_won ? 'Deal marcado como ganho!' : 'Deal movido');
    } catch (err) {
      toast.error('Falha ao mover', { description: extractMessage(err) });
    }
  }

  return (
    <div className="flex flex-col gap-3 border-b border-border bg-card/30 px-5 py-3">
      {/* Linha 1: número + ações ⋯ */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Negócio · #{dealNumber}
        </span>
        <div ref={menuRef} className="relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Mais opções"
            className="h-7 w-7"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-1 w-40 overflow-hidden rounded-md border border-border bg-popover shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void onDelete();
                }}
                disabled={deleting}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Excluir deal
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Linha 2: título inline-editável */}
      <InlineTextField
        value={deal.title}
        placeholder="Sem título"
        className="text-lg font-semibold leading-tight"
        ariaLabel="Título do deal"
        onSave={async (next) => {
          if (next === deal.title) return;
          await save({ title: next }, deal.id, onChanged, 'Título salvo');
        }}
      />

      {/* Linha 3: valor inline-editável + stage dropdown */}
      <div className="flex flex-wrap items-center gap-3">
        <InlineCurrencyField
          value={deal.value}
          currency={deal.currency || 'BRL'}
          onSave={async (next) => {
            if (next === deal.value) return;
            await save({ value: next }, deal.id, onChanged, 'Valor salvo');
          }}
        />

        <StageDropdown
          stages={pipeline?.stages ?? []}
          currentStageId={deal.stage_id}
          currentColor={currentStage?.color ?? '#6B7280'}
          disabled={saving || isClosed}
          onSelect={handleMoveStage}
        />
      </div>

      {/* Linha 4: badges */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Score
          </span>
          <AIScoreCircle score={deal.ai_score} size={28} />
        </div>
        {deal.ai_risk && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Risco
            </span>
            <RiskPill risk={deal.ai_risk} />
          </div>
        )}
        {deal.contact?.temperature && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Temp
            </span>
            <TemperatureBadge temperature={deal.contact.temperature} />
          </div>
        )}
      </div>

      {/* Linha 5: ações Ganho/Perdido */}
      <div className="flex items-center gap-2">
        <Button
          onClick={onMoveToWon}
          disabled={saving || isClosed}
          size="sm"
          className="flex-1 bg-accent hover:bg-accent/90 text-accent-foreground"
        >
          <TrendingUp className="mr-1 h-3.5 w-3.5" />
          {isWon ? 'Ganho' : 'Marcar ganho'}
        </Button>
        <Button
          variant="destructive"
          onClick={onMoveToLost}
          disabled={saving || isClosed}
          size="sm"
          className="flex-1"
        >
          <TrendingDown className="mr-1 h-3.5 w-3.5" />
          {isLost ? 'Perdido' : 'Marcar perdido'}
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Inline-edit primitives
// ──────────────────────────────────────────────────────────

function InlineTextField({
  value,
  placeholder,
  className,
  ariaLabel,
  onSave,
}: {
  value: string;
  placeholder: string;
  className?: string;
  ariaLabel: string;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function commit() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setDraft(value);
      setEditing(false);
      return;
    }
    if (trimmed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch {
      // toast já mostrado no caller via save() helper
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        disabled={saving}
        aria-label={ariaLabel}
        className={cn(
          'rounded-md border border-input bg-background px-2 py-1 outline-none focus:ring-2 focus:ring-ring',
          className,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`${ariaLabel} (clique pra editar)`}
      className={cn(
        'rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/60',
        !value && 'italic text-muted-foreground',
        className,
      )}
    >
      {value || placeholder}
    </button>
  );
}

function InlineCurrencyField({
  value,
  currency,
  onSave,
}: {
  value: number;
  currency: string;
  onSave: (next: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatCurrencyEditable(value));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(formatCurrencyEditable(value));
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function commit() {
    const parsed = parseCurrency(draft);
    if (parsed === null) {
      setDraft(formatCurrencyEditable(value));
      setEditing(false);
      return;
    }
    if (parsed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed);
      setEditing(false);
    } catch {
      setDraft(formatCurrencyEditable(value));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium text-muted-foreground">R$</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            } else if (e.key === 'Escape') {
              setDraft(formatCurrencyEditable(value));
              setEditing(false);
            }
          }}
          disabled={saving}
          inputMode="decimal"
          aria-label="Valor"
          className="w-28 rounded-md border border-input bg-background px-2 py-1 text-sm font-semibold tabular-nums outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label="Valor (clique pra editar)"
      className="rounded-md px-2 py-1 text-sm font-semibold tabular-nums text-accent transition-colors hover:bg-muted/60"
    >
      {formatCurrencyDisplay(value, currency)}
    </button>
  );
}

function StageDropdown({
  stages,
  currentStageId,
  currentColor,
  disabled,
  onSelect,
}: {
  stages: Array<{ id: string; name: string; color: string }>;
  currentStageId: string;
  currentColor: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = stages.find((s) => s.id === currentStageId) ?? null;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-label="Mudar stage"
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          backgroundColor: `${currentColor}20`,
          color: currentColor,
        }}
      >
        {current?.name ?? 'Stage'}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          {stages.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSelect(s.id);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted',
                s.id === currentStageId && 'bg-muted/60',
              )}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="truncate">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

async function save(
  patch: UpdateDealInput,
  dealId: string,
  onChanged: () => void | Promise<void>,
  successLabel: string,
): Promise<void> {
  try {
    await dealsApi.update(dealId, patch);
    await onChanged();
    toast.success(successLabel);
  } catch (err) {
    toast.error('Falha ao salvar', { description: extractMessage(err) });
    throw err;
  }
}

function formatCurrencyDisplay(value: number, currency: string): string {
  if (!value) return 'Sem valor';
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: currency || 'BRL',
    maximumFractionDigits: 0,
  });
}

function formatCurrencyEditable(value: number): string {
  if (!value) return '';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function parseCurrency(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function extractMessage(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return 'Erro desconhecido';
}
