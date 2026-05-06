'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, MessageSquare, Plus, Trash2, Send, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SlackWebhook {
  id: string;
  org_id: string;
  name: string;
  webhook_url: string;
  channel_name: string | null;
  notify_social: boolean;
  notify_ad: boolean;
  notify_sac: boolean;
  min_severity: 'info' | 'warning' | 'critical';
  is_active: boolean;
  last_used_at: string | null;
  last_error: string | null;
}

export default function SlackWebhooksPage() {
  const [webhooks, setWebhooks] = useState<SlackWebhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const refresh = async () => {
    try {
      const list = await api.get<SlackWebhook[]>('/slack-webhooks');
      setWebhooks(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const test = async (id: string) => {
    try {
      const ok = await api.post<boolean>(`/slack-webhooks/${id}/test`, {});
      alert(ok ? '✅ Teste enviado — confere no Slack' : '❌ Falha');
      void refresh();
    } catch (err) {
      alert(`Erro: ${err instanceof Error ? err.message : ''}`);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Remover este webhook?')) return;
    await api.delete<void>(`/slack-webhooks/${id}`);
    void refresh();
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/configuracoes">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <MessageSquare className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Slack Webhooks</h1>
            <p className="text-xs text-muted-foreground">
              Notificações de signals via canais Slack
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5" />
          <span className="ml-1">Novo webhook</span>
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : webhooks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <MessageSquare className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhum webhook configurado. Crie um Incoming Webhook no seu workspace
              Slack (Apps → Incoming Webhooks → cria + escolhe canal → copia URL)
              e cole aqui.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {webhooks.map((w) => (
              <div
                key={w.id}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border bg-card p-4',
                  w.last_error
                    ? 'border-red-500/40'
                    : !w.is_active
                      ? 'border-muted opacity-60'
                      : 'border-border',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-1 items-center gap-2 min-w-0">
                    <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate text-sm font-semibold">{w.name}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => test(w.id)}>
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(w.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {w.channel_name && (
                  <p className="text-xs text-muted-foreground">
                    Canal: #{w.channel_name}
                  </p>
                )}
                <div className="flex flex-wrap gap-1 text-[10px]">
                  {w.notify_social && (
                    <span className="rounded-full bg-pink-500/15 px-1.5 py-0.5 text-pink-700 dark:text-pink-300">
                      Social
                    </span>
                  )}
                  {w.notify_ad && (
                    <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-blue-700 dark:text-blue-300">
                      Ads
                    </span>
                  )}
                  {w.notify_sac && (
                    <span className="rounded-full bg-cyan-500/15 px-1.5 py-0.5 text-cyan-700 dark:text-cyan-300">
                      SAC
                    </span>
                  )}
                  <span className="rounded-full bg-muted px-1.5 py-0.5 uppercase text-muted-foreground">
                    ≥ {w.min_severity}
                  </span>
                </div>
                {w.last_error && (
                  <div className="flex items-start gap-1 rounded border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-700 dark:text-red-300">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{w.last_error}</span>
                  </div>
                )}
                {w.last_used_at && (
                  <p className="text-[10px] text-muted-foreground">
                    Último envio: {new Date(w.last_used_at).toLocaleString('pt-BR')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {showForm && (
          <CreateForm
            onClose={() => setShowForm(false)}
            onCreated={() => {
              setShowForm(false);
              void refresh();
            }}
          />
        )}

        <div className="mt-6 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs">
          <p className="mb-1 font-medium">Como criar Incoming Webhook:</p>
          <ol className="ml-5 list-decimal space-y-0.5 text-foreground/80">
            <li>Slack workspace → Apps → busca &quot;Incoming Webhooks&quot;</li>
            <li>Clica &quot;Add to Slack&quot;, escolhe canal de destino</li>
            <li>Copia a URL (formato: hooks.slack.com/services/...)</li>
            <li>Cola aqui em &quot;URL do Webhook&quot;</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function CreateForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [channel, setChannel] = useState('');
  const [notifySocial, setNotifySocial] = useState(true);
  const [notifyAd, setNotifyAd] = useState(true);
  const [notifySac, setNotifySac] = useState(false);
  const [minSeverity, setMinSeverity] = useState<'info' | 'warning' | 'critical'>('warning');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !url.trim()) return;
    setBusy(true);
    try {
      await api.post<unknown>('/slack-webhooks', {
        name: name.trim(),
        webhook_url: url.trim(),
        channel_name: channel.trim() || undefined,
        notify_social: notifySocial,
        notify_ad: notifyAd,
        notify_sac: notifySac,
        min_severity: minSeverity,
      });
      onCreated();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">Novo Slack Webhook</h2>
        <div className="flex flex-col gap-3">
          <Field label="Nome">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Marketing #alerts"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="URL do Webhook">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
            />
          </Field>
          <Field label="Nome do canal (opcional, só pra exibição)">
            <input
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="alerts"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Categorias">
            <div className="flex flex-wrap gap-2">
              <Toggle label="Social AI" value={notifySocial} onChange={setNotifySocial} />
              <Toggle label="Ads" value={notifyAd} onChange={setNotifyAd} />
              <Toggle label="SAC" value={notifySac} onChange={setNotifySac} />
            </div>
          </Field>
          <Field label="Severity mínima">
            <select
              value={minSeverity}
              onChange={(e) => setMinSeverity(e.target.value as 'info' | 'warning' | 'critical')}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="info">Info (todos)</option>
              <option value="warning">Warning</option>
              <option value="critical">Apenas critical</option>
            </select>
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || !name.trim() || !url.trim()}>
            {busy ? 'Salvando…' : 'Criar'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn(
        'rounded-full border px-2 py-0.5 text-xs',
        value
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-background text-muted-foreground',
      )}
    >
      {label}
    </button>
  );
}
