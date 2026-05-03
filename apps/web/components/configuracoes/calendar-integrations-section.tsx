'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Calendar,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import type { CalendarIntegrationPublic, CalendarProvider } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { calendarIntegrationsApi } from '@/lib/api/calendar-integrations';
import { ApiError } from '@/lib/api/client';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Seção "Integrações de Calendário" — cards Google + Calendly + Outlook (TODO).
 * Pra v1 admin conecta seu próprio (user logado). Future: admin conecta em
 * nome de outro membro via prop `forAgentId`.
 */
export function CalendarIntegrationsSection({ forAgentId }: { forAgentId?: string }) {
  const [integrations, setIntegrations] = useState<CalendarIntegrationPublic[]>([]);
  const [loading, setLoading] = useState(true);

  // Lê callback do OAuth via querystring (?calendar=success&provider=google)
  const search = useSearchParams();
  useEffect(() => {
    const result = search.get('calendar');
    const provider = search.get('provider');
    if (result === 'success' && provider) {
      toast.success(`${provider === 'google' ? 'Google Calendar' : 'Calendly'} conectado!`);
    } else if (result === 'error') {
      toast.error('Falha ao conectar', {
        description: search.get('reason') ?? 'erro',
      });
    }
  }, [search]);

  async function reload() {
    try {
      const data = await calendarIntegrationsApi.list(forAgentId);
      setIntegrations(data);
    } catch (err) {
      toast.error('Falha ao carregar', {
        description: err instanceof ApiError ? err.message : 'erro',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forAgentId]);

  const google = integrations.find((i) => i.provider === 'google');
  const calendly = integrations.find((i) => i.provider === 'calendly');

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold">Integrações de calendário</h3>
        <p className="text-xs text-muted-foreground">
          Conecte seu calendário pra sincronizar agendamentos automaticamente e evitar conflitos
          com sua agenda pessoal.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ProviderCard
          provider="google"
          integration={google}
          onChanged={reload}
          loading={loading}
        />
        <ProviderCard
          provider="calendly"
          integration={calendly}
          onChanged={reload}
          loading={loading}
        />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Card por provider
// ──────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  integration,
  onChanged,
  loading,
}: {
  provider: CalendarProvider;
  integration: CalendarIntegrationPublic | undefined;
  onChanged: () => void | Promise<void>;
  loading: boolean;
}) {
  const isGoogle = provider === 'google';
  const config = isGoogle
    ? {
        name: 'Google Calendar',
        color: '#4285F4',
        description: 'Sync bidirecional + freebusy pra agenda pessoal.',
        icon: Calendar,
      }
    : {
        name: 'Calendly',
        color: '#006BFF',
        description: 'Webhook recebe agendamentos e cria appointments + contatos.',
        icon: Globe,
      };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <config.icon className="h-4 w-4" style={{ color: config.color }} />
          {config.name}
          {integration && integration.status === 'active' && (
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Ativo
            </span>
          )}
          {integration && integration.status === 'error' && (
            <span className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">
              <TriangleAlert className="h-2.5 w-2.5" />
              Erro
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-[11px] text-muted-foreground">{config.description}</p>

        {!integration ? (
          <ConnectButton provider={provider} />
        ) : (
          <ConnectedState integration={integration} onChanged={onChanged} />
        )}
      </CardContent>
    </Card>
  );
}

function ConnectButton({ provider }: { provider: CalendarProvider }) {
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    setLoading(true);
    try {
      const { url } =
        provider === 'google'
          ? await calendarIntegrationsApi.getGoogleAuthUrl()
          : await calendarIntegrationsApi.getCalendlyAuthUrl();
      window.location.href = url;
    } catch (err) {
      toast.error('Falha ao iniciar conexão', {
        description: err instanceof ApiError ? err.message : 'erro',
      });
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleConnect} disabled={loading} className="self-start">
      {loading ? (
        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
      ) : (
        <ExternalLink className="mr-2 h-3 w-3" />
      )}
      Conectar {provider === 'google' ? 'Google' : 'Calendly'}
    </Button>
  );
}

function ConnectedState({
  integration,
  onChanged,
}: {
  integration: CalendarIntegrationPublic;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const isCalendly = integration.provider === 'calendly';
  const schedulingUrl = isCalendly
    ? ((integration.metadata as { scheduling_url?: string } | null)?.scheduling_url ?? null)
    : null;

  async function action(label: string, fn: () => Promise<unknown>, success: string) {
    setBusy(label);
    try {
      await fn();
      toast.success(success);
      await onChanged();
    } catch (err) {
      toast.error('Falha', {
        description: err instanceof ApiError ? err.message : 'erro',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      {/* Calendar info */}
      <div className="rounded-md border border-border bg-card/50 px-2 py-1.5">
        <div className="font-medium">{integration.calendar_name ?? '(sem nome)'}</div>
        {integration.last_synced_at && (
          <span className="text-[10px] text-muted-foreground">
            Último sync {formatRelativeTime(integration.last_synced_at)}
          </span>
        )}
        {integration.last_error && (
          <p className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">
            {integration.last_error}
          </p>
        )}
      </div>

      {/* Scheduling URL (Calendly) */}
      {schedulingUrl && (
        <div className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 text-[11px]">
          <span className="truncate font-mono text-muted-foreground">{schedulingUrl}</span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(schedulingUrl);
              toast.success('Copiado');
            }}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Copiar link"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Toggles */}
      <div className="flex flex-col gap-1.5">
        <ToggleRow
          label="Sincronização ativa"
          checked={integration.sync_enabled}
          onChange={(v) =>
            action(
              'sync_enabled',
              () => calendarIntegrationsApi.updateSettings(integration.id, { sync_enabled: v }),
              `Sync ${v ? 'ativada' : 'desativada'}`,
            )
          }
          disabled={busy !== null}
        />
        {!isCalendly && (
          <ToggleRow
            label="Considerar agenda pessoal (freebusy)"
            checked={integration.consider_personal_events}
            onChange={(v) =>
              action(
                'consider_personal',
                () =>
                  calendarIntegrationsApi.updateSettings(integration.id, {
                    consider_personal_events: v,
                  }),
                'Atualizado',
              )
            }
            disabled={busy !== null}
          />
        )}
        {!isCalendly && (
          <ToggleRow
            label="Sync bidirecional (Google → CRM)"
            checked={integration.bidirectional_sync}
            onChange={(v) =>
              action(
                'bidirectional',
                () =>
                  calendarIntegrationsApi.updateSettings(integration.id, {
                    bidirectional_sync: v,
                  }),
                'Atualizado',
              )
            }
            disabled={busy !== null}
          />
        )}
        {isCalendly && (
          <ToggleRow
            label="Auto-criar deal quando agendarem"
            checked={integration.auto_create_deal}
            onChange={(v) =>
              action(
                'auto_deal',
                () =>
                  calendarIntegrationsApi.updateSettings(integration.id, {
                    auto_create_deal: v,
                  }),
                'Atualizado',
              )
            }
            disabled={busy !== null}
          />
        )}
      </div>

      {/* Ações */}
      <div className="flex items-center gap-1.5 pt-1">
        {!isCalendly && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              action(
                'sync',
                () => calendarIntegrationsApi.syncNow(integration.id),
                'Sincronizado',
              )
            }
            disabled={busy !== null}
          >
            {busy === 'sync' ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Sync agora
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-red-600 hover:text-red-700"
          onClick={() => {
            if (!confirm('Desconectar essa integração? Os tokens serão removidos.')) return;
            void action(
              'disconnect',
              () => calendarIntegrationsApi.disconnect(integration.id),
              'Desconectado',
            );
          }}
          disabled={busy !== null}
        >
          {busy === 'disconnect' ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="mr-1 h-3 w-3" />
          )}
          Desconectar
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className={cn('h-3.5 w-3.5 cursor-pointer rounded border-input', disabled && 'opacity-50')}
      />
      <span>{label}</span>
    </label>
  );
}
