'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Hourglass,
  Loader2,
  PlayCircle,
  RefreshCw,
  Send,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  reEngagementApi,
  type EligibleConversation,
  type ReEngagementRun,
  type ReEngagementSettings,
} from '@/lib/api/re-engagement';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const DEFAULT: ReEngagementSettings = {
  enabled: false,
  days_threshold: 5,
  max_retries: 2,
  only_with_open_deal: true,
  min_advance_days_between: 7,
};

/**
 * Section de Configurações > Concierge > Re-engagement.
 * Configura cron de reativação de leads parados + lista runs recentes
 * + lista conversas elegíveis (preview).
 */
export function ReEngagementSection() {
  const [settings, setSettings] = useState<ReEngagementSettings>(DEFAULT);
  const [runs, setRuns] = useState<ReEngagementRun[]>([]);
  const [eligible, setEligible] = useState<EligibleConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [showEligible, setShowEligible] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const [s, r, e] = await Promise.all([
        reEngagementApi.getSettings(),
        reEngagementApi.listRuns().catch(() => []),
        reEngagementApi.listEligible().catch(() => []),
      ]);
      setSettings(s);
      setRuns(r);
      setEligible(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function handleSave(patch: Partial<ReEngagementSettings>) {
    setSaving(true);
    try {
      const next = await reEngagementApi.updateSettings(patch);
      setSettings(next);
      toast.success('Configurações salvas');
      void reload();
    } catch (err) {
      toast.error('Falha ao salvar', {
        description: err instanceof ApiError ? err.message : 'Erro desconhecido',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    setRunning(true);
    try {
      const result = await reEngagementApi.runNow();
      toast.success('Re-engagement executado', {
        description: `${result.processed} elegíveis · ${result.sent} enviadas · ${result.skipped} skipadas`,
      });
      void reload();
    } catch (err) {
      toast.error('Falha ao executar', {
        description: err instanceof ApiError ? err.message : 'Erro desconhecido',
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base">Re-engagement automático</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Worker dispara mensagem personalizada via IA pra leads que pararam
                de responder. Roda de hora em hora.
              </p>
            </div>
            <ToggleSwitch
              checked={settings.enabled}
              disabled={saving}
              onChange={(enabled) => void handleSave({ enabled })}
            />
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {loading ? (
            <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando…
            </div>
          ) : (
            <>
              <SettingsForm settings={settings} disabled={!settings.enabled || saving} onSave={handleSave} />

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <div className="text-[11px] text-muted-foreground">
                  <strong>{eligible.length}</strong> conversa(s) elegíveis agora
                  com essas configurações
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void reload()}
                    disabled={loading}
                  >
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    Recalcular
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleRunNow()}
                    disabled={!settings.enabled || running || eligible.length === 0}
                  >
                    {running ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <PlayCircle className="mr-1 h-3.5 w-3.5" />
                    )}
                    Rodar agora
                  </Button>
                </div>
              </div>

              {/* Preview elegíveis */}
              <div className="rounded-md border border-border bg-muted/10">
                <button
                  type="button"
                  onClick={() => setShowEligible(!showEligible)}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {showEligible ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  Preview de elegíveis ({eligible.length})
                </button>
                {showEligible && eligible.length > 0 && (
                  <div className="flex flex-col gap-1 px-3 pb-3">
                    {eligible.slice(0, 20).map((e) => (
                      <EligibleRow key={e.conversation_id} item={e} />
                    ))}
                    {eligible.length > 20 && (
                      <span className="text-[10px] italic text-muted-foreground">
                        +{eligible.length - 20} outros
                      </span>
                    )}
                  </div>
                )}
                {showEligible && eligible.length === 0 && (
                  <div className="px-3 pb-3 text-[11px] text-muted-foreground">
                    Nenhuma conversa elegível com essas configurações.
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {runs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Tentativas recentes ({runs.length})</CardTitle>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Histórico de mensagens disparadas pelo worker. Clique pra ver
              detalhes.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {runs.slice(0, 30).map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SettingsForm({
  settings,
  disabled,
  onSave,
}: {
  settings: ReEngagementSettings;
  disabled: boolean;
  onSave: (patch: Partial<ReEngagementSettings>) => Promise<void>;
}) {
  const [days, setDays] = useState(settings.days_threshold);
  const [retries, setRetries] = useState(settings.max_retries);
  const [advance, setAdvance] = useState(settings.min_advance_days_between);
  const [openDeal, setOpenDeal] = useState(settings.only_with_open_deal);

  useEffect(() => {
    setDays(settings.days_threshold);
    setRetries(settings.max_retries);
    setAdvance(settings.min_advance_days_between);
    setOpenDeal(settings.only_with_open_deal);
  }, [settings]);

  const dirty =
    days !== settings.days_threshold ||
    retries !== settings.max_retries ||
    advance !== settings.min_advance_days_between ||
    openDeal !== settings.only_with_open_deal;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Dias parado pra disparar">
          <Input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(e) => setDays(Number(e.target.value) || 1)}
            disabled={disabled}
            className="h-9"
          />
          <span className="text-[10px] text-muted-foreground">
            Lead sem resposta há mais que X dias
          </span>
        </Field>
        <Field label="Máx de tentativas">
          <Input
            type="number"
            min={1}
            max={10}
            value={retries}
            onChange={(e) => setRetries(Number(e.target.value) || 1)}
            disabled={disabled}
            className="h-9"
          />
          <span className="text-[10px] text-muted-foreground">
            Tentativas antes de desistir
          </span>
        </Field>
        <Field label="Intervalo entre tentativas (dias)">
          <Input
            type="number"
            min={1}
            max={60}
            value={advance}
            onChange={(e) => setAdvance(Number(e.target.value) || 1)}
            disabled={disabled}
            className="h-9"
          />
          <span className="text-[10px] text-muted-foreground">
            Pra mesma conversa
          </span>
        </Field>
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={openDeal}
          onChange={(e) => setOpenDeal(e.target.checked)}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 rounded border-input"
        />
        <span className="text-[11px]">
          Só re-engajar leads com card aberto no funil{' '}
          <span className="text-muted-foreground">
            (recomendado — evita reativar leads frios sem contexto)
          </span>
        </span>
      </label>

      {dirty && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() =>
              void onSave({
                days_threshold: days,
                max_retries: retries,
                min_advance_days_between: advance,
                only_with_open_deal: openDeal,
              })
            }
            disabled={disabled}
          >
            Salvar configurações
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[11px]">{label}</Label>
      {children}
    </div>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        checked ? 'bg-cyan-500' : 'bg-muted',
        disabled && 'opacity-60 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function EligibleRow({ item }: { item: EligibleConversation }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-card px-2 py-1.5 text-[11px]">
      <Hourglass className="h-3 w-3 shrink-0 text-amber-500" />
      <span className="font-medium">
        {item.contact_name ?? '(sem nome)'}
      </span>
      <span className="text-muted-foreground">
        · {item.days_since_last_activity}d sem resposta · tentativa #
        {item.retry_number}
      </span>
      {item.deal_tags.length > 0 && (
        <span className="ml-auto truncate text-[10px] text-cyan-600 dark:text-cyan-400">
          {item.deal_tags.slice(0, 3).join(', ')}
        </span>
      )}
    </div>
  );
}

function RunRow({ run }: { run: ReEngagementRun }) {
  const [open, setOpen] = useState(false);
  const ago = relativeTime(run.created_at);
  return (
    <div className="rounded-md border border-border/60 bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px]"
      >
        <StatusBadge status={run.status} />
        <span className="font-medium">Tentativa #{run.retry_number}</span>
        <span className="text-muted-foreground">
          · {run.days_since_last_activity}d parado · {ago}
        </span>
        {run.replied_at && (
          <span className="ml-auto inline-flex items-center gap-1 text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            Respondeu
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border/60 p-2.5 text-[11px]">
          <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
            <Send className="h-3 w-3" />
            <span className="font-medium uppercase tracking-wider">
              Mensagem enviada
            </span>
          </div>
          <p className="whitespace-pre-wrap text-foreground/80">{run.message_text}</p>
          {run.error_message && (
            <div className="mt-2 inline-flex items-start gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-[10px] text-destructive">
              <AlertCircle className="mt-0.5 h-3 w-3" />
              {run.error_message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'ok' | 'failed' | 'skipped' }) {
  if (status === 'ok')
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />;
  if (status === 'failed')
    return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  return <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}
