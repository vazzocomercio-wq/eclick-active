'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  WEBHOOK_EVENT_TYPES,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEventType,
} from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  outboundWebhooksApi,
  type CreateWebhookEndpointInput,
} from '@/lib/api/outbound-webhooks';
import { ApiError } from '@/lib/api/client';
import { useConfirm } from '@/components/ui/confirm-provider';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const EVENT_GROUPS: Record<string, WebhookEventType[]> = {
  Contato: ['contact.created', 'contact.updated', 'contact.deleted'],
  Negócios: [
    'deal.created',
    'deal.updated',
    'deal.stage_changed',
    'deal.won',
    'deal.lost',
  ],
  Conversas: [
    'conversation.created',
    'conversation.message_received',
    'conversation.message_sent',
    'conversation.resolved',
  ],
  Tarefas: ['task.created', 'task.completed', 'task.overdue'],
  IA: ['ai.score_calculated', 'ai.suggestion_generated'],
  Outros: ['automation.executed'],
};

export function WebhooksSection() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState<WebhookEndpoint | null>(null);

  const [detailEndpoint, setDetailEndpoint] = useState<WebhookEndpoint | null>(null);
  const confirm = useConfirm();

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setEndpoints(await outboundWebhooksApi.list());
    } catch (err) {
      setError(extractMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-sm">Webhooks de saída</CardTitle>
          <p className="text-xs text-muted-foreground">
            Receba eventos do CRM em URLs externas (Zapier, n8n, integrações próprias).
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditingEndpoint(null); setDialogOpen(true); }}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Novo webhook
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {!loading && endpoints.length === 0 && (
          <p className="py-6 text-center text-xs italic text-muted-foreground">
            Nenhum webhook cadastrado.
          </p>
        )}
        {endpoints.map((ep) => (
          <EndpointCard
            key={ep.id}
            endpoint={ep}
            onClick={() => setDetailEndpoint(ep)}
            onEdit={() => {
              setEditingEndpoint(ep);
              setDialogOpen(true);
            }}
            onDelete={async () => {
              const ok = await confirm({
                title: `Excluir webhook "${ep.name}"?`,
                description: 'Os eventos não serão mais disparados pra esse endpoint.',
                variant: 'destructive',
                confirmLabel: 'Excluir',
                icon: Trash2,
              });
              if (!ok) return;
              try {
                await outboundWebhooksApi.remove(ep.id);
                toast.success('Webhook excluído');
                void reload();
              } catch (err) {
                toast.error('Falha ao excluir', { description: extractMessage(err) });
              }
            }}
            onToggle={async () => {
              try {
                await outboundWebhooksApi.update(ep.id, { is_active: !ep.is_active });
                void reload();
              } catch (err) {
                toast.error('Falha ao atualizar', { description: extractMessage(err) });
              }
            }}
            onTest={async () => {
              try {
                const result = await outboundWebhooksApi.test(ep.id);
                if (result.status === 'success') {
                  toast.success(`Teste OK (${result.response_status})`);
                } else {
                  toast.error('Teste falhou', { description: result.error ?? 'Sem detalhes' });
                }
                void reload();
              } catch (err) {
                toast.error('Falha ao testar', { description: extractMessage(err) });
              }
            }}
          />
        ))}
      </CardContent>

      {/* Dialog criar/editar */}
      <EndpointDialog
        open={dialogOpen}
        editing={editingEndpoint}
        onClose={() => {
          setDialogOpen(false);
          setEditingEndpoint(null);
        }}
        onSaved={() => {
          setDialogOpen(false);
          setEditingEndpoint(null);
          void reload();
        }}
      />

      {/* Sheet de detalhe + deliveries */}
      <DetailSheet
        endpoint={detailEndpoint}
        onClose={() => setDetailEndpoint(null)}
        onChanged={reload}
      />
    </Card>
  );
}

// ──────────────────────────────────────────────────────────
// EndpointCard
// ──────────────────────────────────────────────────────────

function EndpointCard({
  endpoint,
  onClick,
  onEdit,
  onDelete,
  onToggle,
  onTest,
}: {
  endpoint: WebhookEndpoint;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onTest: () => void;
}) {
  const unhealthy = endpoint.failure_count >= 10;
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border bg-card px-3 py-2 transition-colors',
        endpoint.is_active ? 'border-border' : 'border-border/50 opacity-60',
        unhealthy && 'border-destructive/40 [animation:pulse_2s_ease-in-out_infinite]',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onClick}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left hover:text-primary"
        >
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{endpoint.name}</span>
            {endpoint.is_active ? (
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            ) : (
              <XCircle className="h-3 w-3 text-muted-foreground" />
            )}
            {unhealthy && (
              <span className="inline-flex items-center gap-0.5 rounded-sm bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                <AlertTriangle className="h-2.5 w-2.5" />
                {endpoint.failure_count} falhas
              </span>
            )}
          </div>
          <span className="truncate text-[11px] text-muted-foreground">{endpoint.url}</span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onToggle}
            title={endpoint.is_active ? 'Desativar' : 'Ativar'}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {endpoint.is_active ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onTest}
            title="Testar"
            className="rounded-md p-1 text-muted-foreground hover:bg-primary/10 hover:text-primary"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="Editar"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Excluir"
            className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {endpoint.events.map((e) => (
          <span
            key={e}
            className="inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
          >
            {e}
          </span>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// EndpointDialog (criar/editar)
// ──────────────────────────────────────────────────────────

function EndpointDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: WebhookEndpoint | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<WebhookEventType[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setUrl(editing?.url ?? '');
    setSecret(editing?.secret ?? '');
    setEvents(editing?.events ?? []);
  }, [open, editing]);

  function toggleEvent(e: WebhookEventType) {
    setEvents((curr) =>
      curr.includes(e) ? curr.filter((x) => x !== e) : [...curr, e],
    );
  }

  function generateSecret() {
    const random = crypto.getRandomValues(new Uint8Array(24));
    setSecret(
      Array.from(random)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim() || events.length === 0) return;
    setSubmitting(true);
    try {
      const input: CreateWebhookEndpointInput = {
        name: name.trim(),
        url: url.trim(),
        events,
        ...(secret.trim() ? { secret: secret.trim() } : { secret: null }),
      };
      if (editing) {
        await outboundWebhooksApi.update(editing.id, input);
        toast.success('Webhook atualizado');
      } else {
        await outboundWebhooksApi.create(input);
        toast.success('Webhook criado');
      }
      onSaved();
    } catch (err) {
      toast.error('Falha ao salvar', { description: extractMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar webhook' : 'Novo webhook'}</DialogTitle>
            <DialogDescription>
              POST será enviado pra essa URL toda vez que um dos eventos selecionados ocorrer.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Nome</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Zapier — sincronizar leads"
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">URL</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.zapier.com/..."
                type="url"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">
                Secret HMAC (opcional)
                <span className="ml-1 font-normal text-muted-foreground">
                  — header X-Webhook-Signature
                </span>
              </Label>
              <div className="flex items-stretch gap-1.5">
                <Input
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="Cole aqui ou gere"
                  className="flex-1"
                />
                <Button type="button" variant="outline" size="sm" onClick={generateSecret}>
                  <RefreshCw className="mr-1 h-3 w-3" />
                  Gerar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!secret}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(secret);
                      toast.success('Copiado');
                    } catch {
                      // ignore
                    }
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-xs">Eventos</Label>
              <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
                {Object.entries(EVENT_GROUPS).map(([groupName, types]) => (
                  <div key={groupName} className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {groupName}
                    </span>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {types.map((e) => (
                        <label
                          key={e}
                          className="inline-flex items-center gap-1.5 text-[11px]"
                        >
                          <input
                            type="checkbox"
                            checked={events.includes(e)}
                            onChange={() => toggleEvent(e)}
                            className="h-3.5 w-3.5 accent-primary"
                          />
                          <code className="text-[10px]">{e}</code>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {events.length} evento(s) selecionado(s) de {WEBHOOK_EVENT_TYPES.length}.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={submitting || !name.trim() || !url.trim() || events.length === 0}
            >
              {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {editing ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// DetailSheet — mostra deliveries
// ──────────────────────────────────────────────────────────

function DetailSheet({
  endpoint,
  onClose,
  onChanged,
}: {
  endpoint: WebhookEndpoint | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function reload() {
    if (!endpoint) return;
    setLoading(true);
    try {
      setDeliveries(await outboundWebhooksApi.getDeliveries(endpoint.id));
    } catch (err) {
      toast.error('Falha ao carregar histórico', {
        description: extractMessage(err),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (endpoint) void reload();
    else setDeliveries([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint?.id]);

  return (
    <Sheet open={!!endpoint} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full max-w-xl flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle>{endpoint?.name ?? 'Webhook'}</SheetTitle>
          <SheetDescription className="truncate text-xs">
            {endpoint?.url}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Últimas deliveries ({deliveries.length})
            </span>
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
          </div>

          {loading && deliveries.length === 0 && (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          )}

          {!loading && deliveries.length === 0 && (
            <p className="text-center text-xs italic text-muted-foreground">
              Sem deliveries ainda. Use o botão &ldquo;Testar&rdquo; no card pra disparar uma de exemplo.
            </p>
          )}

          <ul className="flex flex-col gap-1.5">
            {deliveries.map((d) => (
              <DeliveryRow
                key={d.id}
                delivery={d}
                expanded={expanded === d.id}
                onToggle={() => setExpanded((curr) => (curr === d.id ? null : d.id))}
                onRetry={async () => {
                  try {
                    await outboundWebhooksApi.retryDelivery(d.id);
                    toast.success('Reenviado');
                    void reload();
                    void onChanged();
                  } catch (err) {
                    toast.error('Falha ao reenviar', { description: extractMessage(err) });
                  }
                }}
              />
            ))}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DeliveryRow({
  delivery,
  expanded,
  onToggle,
  onRetry,
}: {
  delivery: WebhookDelivery;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
}) {
  const isSuccess = delivery.status === 'success';
  return (
    <li className="rounded-md border border-border bg-card text-xs">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
            isSuccess
              ? 'bg-emerald-500/15 text-emerald-500'
              : 'bg-destructive/15 text-destructive',
          )}
        >
          {isSuccess ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
        </span>
        <div className="flex flex-1 flex-col gap-0.5 min-w-0">
          <span className="truncate font-medium">{delivery.event_type}</span>
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(delivery.created_at)}
            {delivery.response_status !== null && ` · HTTP ${delivery.response_status}`}
            {delivery.response_time_ms !== null && ` · ${delivery.response_time_ms}ms`}
            {delivery.attempt > 1 && ` · tentativa ${delivery.attempt}`}
          </span>
        </div>
        {!isSuccess && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            className="rounded-md p-1 text-muted-foreground hover:bg-primary/10 hover:text-primary"
            title="Reenviar"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
          {delivery.error && (
            <div className="rounded-sm bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
              {delivery.error}
            </div>
          )}
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Payload
            </span>
            <pre className="mt-1 max-h-40 overflow-auto rounded-sm bg-muted p-2 text-[10px] font-mono">
              {JSON.stringify(delivery.payload, null, 2)}
            </pre>
          </div>
          {delivery.response_body && (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Response body
              </span>
              <pre className="mt-1 max-h-40 overflow-auto rounded-sm bg-muted p-2 text-[10px] font-mono">
                {delivery.response_body}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function extractMessage(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return 'Erro desconhecido';
}
