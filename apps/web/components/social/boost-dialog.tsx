'use client';

import { useEffect, useState } from 'react';
import {
  Sparkles,
  Megaphone,
  ExternalLink,
  DollarSign,
  Users,
  Target,
} from 'lucide-react';
import {
  socialApi,
  type SocialAdBoostDraft,
  type BoostSuggestion,
  type BoostObjective,
} from '@/lib/api/social';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const OBJECTIVE_LABEL: Record<BoostObjective, string> = {
  OUTCOME_AWARENESS: 'Reconhecimento',
  OUTCOME_TRAFFIC: 'Tráfego',
  OUTCOME_ENGAGEMENT: 'Engajamento',
  OUTCOME_LEADS: 'Leads',
  OUTCOME_APP_PROMOTION: 'App',
  OUTCOME_SALES: 'Vendas',
};

interface BoostDialogProps {
  contentId: string;
  signalId?: string;
  onClose: () => void;
}

/**
 * Dialog de boost. Fluxo:
 *   1. Pede sugestão IA (suggest endpoint, ~5-10s)
 *   2. Mostra preview editável de budget/duração/audiência
 *   3. Usuário clica "Criar draft" → POST /boost-draft
 *   4. Mostra deep link pro Meta Ads Manager
 *   5. Botão "Marcar como enviado" depois que usuário ativa lá
 */
export function BoostDialog({ contentId, signalId, onClose }: BoostDialogProps) {
  const [phase, setPhase] = useState<'loading' | 'suggesting' | 'review' | 'created'>('suggesting');
  const [suggestion, setSuggestion] = useState<BoostSuggestion | null>(null);
  const [draft, setDraft] = useState<SocialAdBoostDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Edit state — partem da sugestão IA
  const [budgetBrl, setBudgetBrl] = useState(50);
  const [durationDays, setDurationDays] = useState(7);
  const [objective, setObjective] = useState<BoostObjective>('OUTCOME_ENGAGEMENT');

  useEffect(() => {
    void (async () => {
      try {
        const s = await socialApi.boost.suggest(contentId);
        setSuggestion(s);
        setBudgetBrl(Math.round(s.daily_budget_cents / 100));
        setDurationDays(s.duration_days);
        setObjective(s.objective);
        setPhase('review');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao gerar sugestão');
      }
    })();
  }, [contentId]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await socialApi.boost.createDraft(contentId, signalId);
      // Aplica edits do usuário se diferiram da sugestão
      if (
        d.daily_budget_cents !== budgetBrl * 100 ||
        d.duration_days !== durationDays ||
        d.objective !== objective
      ) {
        const patched = await socialApi.boost.updateDraft(d.id, {
          daily_budget_cents: budgetBrl * 100,
          duration_days: durationDays,
          objective,
        });
        setDraft(patched);
      } else {
        setDraft(d);
      }
      setPhase('created');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar draft');
    } finally {
      setBusy(false);
    }
  };

  const openMetaAndMarkSent = async () => {
    if (!draft?.meta_deep_link) return;
    window.open(draft.meta_deep_link, '_blank', 'noopener');
    try {
      await socialApi.boost.markSent(draft.id);
    } catch {
      /* best-effort */
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Megaphone className="h-4 w-4 text-primary" />
            Promover como ad
          </h2>
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {phase === 'suggesting' && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Sparkles className="h-8 w-8 animate-pulse text-cyan-500" />
            <p className="text-sm text-muted-foreground">
              IA analisando o post + marca pra sugerir budget e audiência…
            </p>
          </div>
        )}

        {phase === 'review' && suggestion && (
          <>
            {/* Sugestão IA */}
            <div className="mb-4 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                <Sparkles className="h-3.5 w-3.5" />
                Sugestão IA
              </h3>
              <p className="text-xs text-foreground/80">
                {suggestion.budget_rationale}
              </p>
              <p className="mt-2 text-xs text-foreground/80">
                <span className="font-medium">Audiência sugerida:</span>{' '}
                {suggestion.audience_summary}
              </p>
            </div>

            {/* Edição */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Budget diário (R$)" icon={DollarSign}>
                <input
                  type="number"
                  min={10}
                  max={5000}
                  value={budgetBrl}
                  onChange={(e) => setBudgetBrl(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono"
                />
              </Field>
              <Field label="Duração (dias)" icon={Target}>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={durationDays}
                  onChange={(e) => setDurationDays(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono"
                />
              </Field>
              <Field label="Objetivo" icon={Target}>
                <select
                  value={objective}
                  onChange={(e) => setObjective(e.target.value as BoostObjective)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                >
                  {(Object.keys(OBJECTIVE_LABEL) as BoostObjective[]).map((o) => (
                    <option key={o} value={o}>
                      {OBJECTIVE_LABEL[o]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Total estimado */}
            <div className="mt-3 rounded-md border border-border bg-background p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Investimento total estimado</span>
                <span className="font-mono font-medium">
                  R$ {(budgetBrl * durationDays).toLocaleString('pt-BR')}
                </span>
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>{budgetBrl}/dia × {durationDays} dias</span>
                <span>Brasil · {suggestion.age_min}–{suggestion.age_max} anos</span>
              </div>
            </div>

            {/* Copy suggestions */}
            {suggestion.copy_suggestions.length > 0 && (
              <div className="mt-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Variações de copy sugeridas pela IA
                </h4>
                <div className="flex flex-col gap-2">
                  {suggestion.copy_suggestions.slice(0, 2).map((c, i) => (
                    <div
                      key={i}
                      className="rounded-md border border-border bg-muted/30 p-2 text-xs"
                    >
                      <p className="whitespace-pre-line">{c.caption}</p>
                      <p className="mt-1 text-[10px] italic text-muted-foreground">
                        💡 {c.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="mt-4 text-[10px] text-muted-foreground">
              Ao clicar &quot;Criar draft&quot;, geramos o draft no Active e você
              recebe um link pro Meta Ads Manager — você ativa lá manualmente
              (Active não cria campanha automaticamente pra evitar gastos
              não autorizados).
            </p>

            {error && (
              <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button size="sm" onClick={create} disabled={busy}>
                {busy ? 'Criando…' : 'Criar draft'}
              </Button>
            </div>
          </>
        )}

        {phase === 'created' && draft && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                ✅ Draft criado
              </h3>
              <p className="mt-1 text-xs text-foreground/80">
                Próximo passo: abre o Meta Ads Manager pelo link abaixo, valida
                a configuração e ativa a campanha.
              </p>
            </div>

            <div className="rounded-md border border-border bg-background p-3 text-xs">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Resumo
              </p>
              <p className="mt-1">
                <span className="font-mono">R$ {budgetBrl}</span>/dia ×{' '}
                <span className="font-mono">{durationDays}</span> dias = total{' '}
                <span className="font-mono">R$ {budgetBrl * durationDays}</span>
              </p>
              <p className="text-[10px] text-muted-foreground">
                Objetivo: {OBJECTIVE_LABEL[objective]}
              </p>
            </div>

            <Button
              size="sm"
              onClick={openMetaAndMarkSent}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="ml-1">Abrir Meta Ads Manager</span>
            </Button>
            <Button size="sm" variant="outline" onClick={onClose}>
              Fechar (revisar depois)
            </Button>
          </div>
        )}

        {error && phase === 'suggesting' && (
          <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof Users;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      {children}
    </label>
  );
}
