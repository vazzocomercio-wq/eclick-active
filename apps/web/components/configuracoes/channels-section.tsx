'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  Cable,
  Instagram,
  Loader2,
  MessageCircle,
  Pause,
  Plus,
  Play,
  QrCode,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ChannelStatus } from '@eclick-active/shared';
import { BaileysConnectDialog } from './baileys-connect-dialog';
import { Button } from '@/components/ui/button';
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
  channelsApi,
  type ChannelView,
  type CreateChannelInput,
} from '@/lib/api/channels';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/client';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<ChannelStatus, { bg: string; text: string; label: string }> = {
  active: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Ativo' },
  paused: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Pausado' },
  error: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Erro' },
  pending: { bg: 'bg-slate-500/15', text: 'text-slate-400', label: 'Pendente' },
  disconnected: { bg: 'bg-slate-500/15', text: 'text-slate-400', label: 'Desconectado' },
};

const STALE_THRESHOLD_MS = 60 * 60 * 1000;

export function ChannelsSection() {
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [baileysDialogOpen, setBaileysDialogOpen] = useState(false);
  const [connectingInstagram, setConnectingInstagram] = useState(false);

  // Lê callback do OAuth Instagram (?channel=success&provider=instagram)
  const search = useSearchParams();
  useEffect(() => {
    const result = search.get('channel');
    const provider = search.get('provider');
    if (result === 'success' && provider === 'instagram') {
      const count = search.get('count');
      toast.success('Instagram conectado!', {
        description: count ? `${count} conta(s) ativa(s)` : undefined,
      });
    } else if (result === 'error') {
      toast.error('Falha ao conectar canal', {
        description: search.get('reason') ?? 'erro',
      });
    }
  }, [search]);

  async function connectInstagram() {
    setConnectingInstagram(true);
    try {
      const { url } = await api.get<{ url: string }>('/channels/instagram/auth');
      window.location.href = url;
    } catch (err) {
      toast.error('Falha ao iniciar conexão Instagram', {
        description: err instanceof ApiError ? err.message : 'erro',
      });
      setConnectingInstagram(false);
    }
  }

  const reload = useCallback(async () => {
    setError(null);
    try {
      const list = await channelsApi.list();
      setChannels(list);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar canais',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function togglePause(channel: ChannelView) {
    if (!['active', 'paused'].includes(channel.status)) return;
    try {
      const updated = await channelsApi.update(channel.id, {
        paused: channel.status === 'active',
      });
      setChannels((curr) => curr.map((c) => (c.id === channel.id ? updated : c)));
    } catch {
      // ignora; reload manual disponível
    }
  }

  async function disconnect(channel: ChannelView) {
    if (!confirm(`Desconectar "${channel.name}"? Mensagens não serão recebidas.`))
      return;
    try {
      await channelsApi.remove(channel.id);
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao desconectar');
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cable className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Canais Conectados</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBaileysDialogOpen(true)}
          >
            <QrCode className="mr-2 h-3.5 w-3.5" />
            WhatsApp Gratuito
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            WhatsApp (Z-API)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={connectInstagram}
            disabled={connectingInstagram}
            className="border-pink-500/30 text-pink-500 hover:bg-pink-500/10 hover:text-pink-600"
          >
            {connectingInstagram ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Instagram className="mr-2 h-3.5 w-3.5" />
            )}
            Instagram
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <SkeletonList />
      ) : channels.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          Nenhum canal conectado. Conecte seu WhatsApp para começar a receber leads.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {channels.map((c) => (
            <ChannelRow
              key={c.id}
              channel={c}
              onTogglePause={() => void togglePause(c)}
              onDisconnect={() => void disconnect(c)}
            />
          ))}
        </ul>
      )}

      <ConnectChannelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => void reload()}
      />

      <BaileysConnectDialog
        open={baileysDialogOpen}
        onOpenChange={setBaileysDialogOpen}
        onConnected={() => void reload()}
      />
    </section>
  );
}

function ChannelRow({
  channel,
  onTogglePause,
  onDisconnect,
}: {
  channel: ChannelView;
  onTogglePause: () => void;
  onDisconnect: () => void;
}) {
  const s = STATUS_STYLES[channel.status];
  const isStale =
    channel.last_webhook_at !== null &&
    Date.now() - new Date(channel.last_webhook_at).getTime() > STALE_THRESHOLD_MS &&
    channel.status === 'active';

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background/50 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
        <MessageCircle className="h-4 w-4" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{channel.name}</span>
          <span className="text-[11px] uppercase text-muted-foreground">
            {channel.channel_type}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium',
              s.bg,
              s.text,
            )}
          >
            {s.label}
          </span>
          {isStale && (
            <span className="inline-flex items-center gap-1 rounded-md bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400">
              <AlertCircle className="h-2.5 w-2.5" />
              Sem atividade há 1h+
            </span>
          )}
        </div>
        <span className="truncate text-[11px] text-muted-foreground">
          {channel.phone_number ?? '—'}
          {channel.last_webhook_at &&
            ` · último evento ${formatRelativeTime(channel.last_webhook_at)}`}
          {channel.error_message && ` · ${channel.error_message.slice(0, 40)}`}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {(channel.status === 'active' || channel.status === 'paused') && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={onTogglePause}
            title={channel.status === 'active' ? 'Pausar' : 'Reativar'}
          >
            {channel.status === 'active' ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDisconnect}
          title="Desconectar"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Connect channel dialog (WhatsApp / Z-API)
// ──────────────────────────────────────────────────────────

function ConnectChannelDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [token, setToken] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setInstanceId('');
      setToken('');
      setPhoneNumber('');
      setError(null);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !instanceId.trim() || !token.trim()) return;
    setSubmitting(true);
    setError(null);

    const dto: CreateChannelInput = {
      channel_type: 'whatsapp',
      name: name.trim(),
      credentials: {
        provider: 'zapi',
        instance_id: instanceId.trim(),
        token: token.trim(),
      },
      ...(phoneNumber.trim() ? { phone_number: phoneNumber.trim() } : {}),
    };

    try {
      await channelsApi.create(dto);
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao conectar',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Conectar WhatsApp (Z-API)</DialogTitle>
            <DialogDescription>
              Cole as credenciais da sua instância Z-API. Outros canais em breve.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <Field label="Nome do canal" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: WhatsApp Principal"
                required
                autoFocus
              />
            </Field>
            <Field label="Instance ID (Z-API)" required>
              <Input
                value={instanceId}
                onChange={(e) => setInstanceId(e.target.value)}
                placeholder="3D..."
                required
              />
            </Field>
            <Field label="Token (Z-API)" required>
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="..."
                required
                type="password"
              />
            </Field>
            <Field label="Telefone (opcional)">
              <Input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="5571999999999"
              />
            </Field>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                submitting || !name.trim() || !instanceId.trim() || !token.trim()
              }
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Conectar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}
