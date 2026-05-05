'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plug,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  adIntegrationsApi,
  type AdIntegration,
} from '@/lib/api/active-intelligence';
import { ApiError } from '@/lib/api/client';

/**
 * /configuracoes > Integrações de Anúncios.
 *
 * Lista as ad_accounts conectadas + botões pra conectar Meta/Google +
 * trigger manual de sync + desconectar.
 */
export function AdIntegrationsSection() {
  const [integrations, setIntegrations] = useState<AdIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<'meta' | 'google' | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const data = await adIntegrationsApi.list();
      setIntegrations(data);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Falha ao carregar integrações',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  // Detecta retorno do OAuth callback via query string (?ads_ok ou ?ads_error)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ok = params.get('ads_ok');
    const err = params.get('ads_error');
    const accounts = params.get('accounts');
    if (ok) {
      toast.success(`Conectado ${ok.toUpperCase()} (${accounts ?? '?'} conta(s))`);
      // Limpa query string sem reload
      window.history.replaceState({}, '', window.location.pathname);
      void reload();
    } else if (err) {
      toast.error(`Falha ao conectar: ${decodeURIComponent(err)}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function handleConnect(platform: 'meta' | 'google') {
    setConnecting(platform);
    try {
      const { url } =
        platform === 'meta'
          ? await adIntegrationsApi.getMetaConnectUrl()
          : await adIntegrationsApi.getGoogleConnectUrl();
      window.location.href = url;
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Falha ao iniciar OAuth';
      toast.error(msg);
      setConnecting(null);
    }
  }

  async function handleSync(integrationId: string) {
    setSyncingId(integrationId);
    try {
      const result = await adIntegrationsApi.syncManual(integrationId);
      toast.success(
        `Sync ok — ${result.campaigns_upserted} campanha(s), ${result.metrics_upserted} métricas`,
      );
      void reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao sincronizar');
    } finally {
      setSyncingId(null);
    }
  }

  async function handleDisconnect(integration: AdIntegration) {
    if (!confirm(`Desconectar ${integration.platform.toUpperCase()} (${integration.account_name ?? integration.ad_account_id})?`)) {
      return;
    }
    try {
      await adIntegrationsApi.disconnect(integration.id);
      toast.success('Integração desconectada');
      void reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao desconectar');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-primary" />
          Integrações de Anúncios
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Conecte Meta Ads e Google Ads pra monitorar campanhas, métricas e receber alertas inteligentes.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Connect buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={connecting !== null}
            onClick={() => handleConnect('meta')}
            className="gap-2"
          >
            {connecting === 'meta' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <span className="text-blue-500">f</span>
            )}
            Conectar Meta Ads
          </Button>
          <Button
            variant="outline"
            disabled={connecting !== null}
            onClick={() => handleConnect('google')}
            className="gap-2"
          >
            {connecting === 'google' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <span className="text-amber-500">G</span>
            )}
            Conectar Google Ads
          </Button>
        </div>

        {/* List */}
        <div className="flex flex-col gap-2">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando…
            </div>
          ) : integrations.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
              Nenhuma integração conectada ainda.
            </div>
          ) : (
            integrations.map((i) => (
              <IntegrationRow
                key={i.id}
                integration={i}
                syncing={syncingId === i.id}
                onSync={() => handleSync(i.id)}
                onDisconnect={() => handleDisconnect(i)}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function IntegrationRow({
  integration,
  syncing,
  onSync,
  onDisconnect,
}: {
  integration: AdIntegration;
  syncing: boolean;
  onSync: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card/50 px-3 py-2.5">
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <StatusIcon status={integration.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              {integration.platform}
            </span>
            <span className="truncate text-sm">
              {integration.account_name ?? integration.ad_account_id}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {integration.last_sync_at
              ? `Última sync: ${new Date(integration.last_sync_at).toLocaleString('pt-BR')}`
              : 'Nunca sincronizou'}
            {integration.error_message && ` · ${integration.error_message.slice(0, 80)}`}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={syncing || integration.status !== 'active'}
          onClick={onSync}
          title="Sincronizar agora"
        >
          {syncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDisconnect}
          title="Desconectar"
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: AdIntegration['status'] }) {
  switch (status) {
    case 'active':
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
    case 'token_expired':
      return <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />;
    case 'error':
      return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
    default:
      return <AlertCircle className="h-4 w-4 shrink-0 text-muted-foreground" />;
  }
}
