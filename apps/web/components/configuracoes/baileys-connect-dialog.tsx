'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Smartphone, XCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { channelsApi, type ChannelView } from '@/lib/api/channels';
import { ApiError } from '@/lib/api/client';
import { getSocket } from '@/lib/realtime/socket-client';

type Stage = 'name' | 'awaiting-qr' | 'connecting' | 'connected' | 'error';

interface BaileysQrPayload {
  channel_id: string;
  qr: string;
}

interface BaileysConnectedPayload {
  channel_id: string;
  phone_number: string;
  display_name?: string;
}

interface BaileysDisconnectedPayload {
  channel_id: string;
  reason: string;
  needs_reauth: boolean;
}

/**
 * Dialog de pareamento WhatsApp via Baileys (QR Code).
 *
 * Fluxo:
 *   1. Usuário digita nome → POST /channels (cria row pending)
 *   2. Worker detecta no próximo poll, gera QR, emite whatsapp:qr
 *   3. Dialog renderiza QR (atualiza a cada ~20s automaticamente)
 *   4. Usuário escaneia → Baileys conecta → worker emite whatsapp:connected
 *   5. Mostra "Conectado!" com número/nome
 */
export function BaileysConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConnected: () => void;
}) {
  const [stage, setStage] = useState<Stage>('name');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelView | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [connectedInfo, setConnectedInfo] = useState<{
    phone: string;
    name?: string;
  } | null>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStage('name');
      setName('');
      setError(null);
      setChannel(null);
      setQr(null);
      setConnectedInfo(null);
    }
  }, [open]);

  // Subscribe a eventos socket.io quando estiver aguardando QR/conectando
  useEffect(() => {
    if (!channel) return;
    if (stage !== 'awaiting-qr' && stage !== 'connecting') return;

    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;

      const onQr = (payload: BaileysQrPayload) => {
        if (payload.channel_id !== channel.id) return;
        setQr(payload.qr);
        setStage('awaiting-qr');
      };
      const onConn = (payload: BaileysConnectedPayload) => {
        if (payload.channel_id !== channel.id) return;
        setConnectedInfo({
          phone: payload.phone_number,
          ...(payload.display_name ? { name: payload.display_name } : {}),
        });
        setStage('connected');
      };
      const onDisc = (payload: BaileysDisconnectedPayload) => {
        if (payload.channel_id !== channel.id) return;
        if (!payload.needs_reauth) {
          // Disconnect transient (restartRequired etc.) — worker já vai
          // reabrir o socket sozinho. Mantém o usuário em "awaiting-qr" e
          // limpa o QR antigo pra UX mostrar o spinner novamente.
          setQr(null);
          setStage('awaiting-qr');
          return;
        }
        setError(`Desconectado: ${payload.reason}`);
        setStage('error');
      };

      socket.on('whatsapp:qr', onQr);
      socket.on('whatsapp:connected', onConn);
      socket.on('whatsapp:disconnected', onDisc);

      cleanup = () => {
        socket.off('whatsapp:qr', onQr);
        socket.off('whatsapp:connected', onConn);
        socket.off('whatsapp:disconnected', onDisc);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [channel, stage]);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const created = await channelsApi.create({
        channel_type: 'whatsapp_free',
        name: name.trim(),
        // credentials vazio → status='pending' até worker parear
        credentials: { provider: 'baileys' },
      });
      setChannel(created);
      setStage('awaiting-qr');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao criar canal',
      );
      setStage('error');
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Apaga o canal recém-criado se o user fechar o dialog antes de
   * completar o pareamento. Sem isso, cada tentativa abandonada deixa
   * uma row pending órfã que o worker tenta parear pra sempre.
   *
   * Se já conectou (stage='connected'), o canal é mantido — o
   * pareamento foi efetivo.
   */
  async function abortIfNotConnected(): Promise<void> {
    if (!channel) return;
    if (stage === 'connected') return;
    try {
      await channelsApi.remove(channel.id);
    } catch {
      // Best-effort. Worker tem cleanup de pending antigos como rede.
    }
  }

  async function handleClose() {
    if (stage === 'connected') {
      onConnected();
      onOpenChange(false);
      return;
    }
    await abortIfNotConnected();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (submitting) return;
        if (!o) {
          // Fecha via Esc / click fora — também aborta canal pending
          void handleClose();
        } else {
          onOpenChange(o);
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>WhatsApp Gratuito (QR Code)</DialogTitle>
          <DialogDescription>
            {stage === 'name' &&
              'Pareia seu WhatsApp via QR code. Sem custo por mensagem.'}
            {stage === 'awaiting-qr' &&
              'Abra o WhatsApp no celular e escaneie o QR code abaixo.'}
            {stage === 'connecting' && 'Conectando...'}
            {stage === 'connected' && 'WhatsApp conectado com sucesso!'}
            {stage === 'error' && 'Algo deu errado.'}
          </DialogDescription>
        </DialogHeader>

        {stage === 'name' && (
          <form onSubmit={handleStart} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Nome do canal *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: WhatsApp Comercial"
                required
                autoFocus
              />
            </div>
            {error && (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting || !name.trim()}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Gerar QR Code
              </Button>
            </div>
          </form>
        )}

        {stage === 'awaiting-qr' && (
          <div className="flex flex-col items-center gap-4 py-2">
            {qr ? (
              <div className="rounded-lg border-2 border-border bg-white p-4">
                <QRCodeSVG value={qr} size={232} level="M" />
              </div>
            ) : (
              <div className="flex h-[264px] w-[264px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Gerando QR code...</p>
              </div>
            )}
            <ol className="flex flex-col gap-1 text-xs text-muted-foreground">
              <li>1. Abra o WhatsApp no celular</li>
              <li>
                2. Toque em <strong className="text-foreground">Mais opções</strong> →{' '}
                <strong className="text-foreground">Aparelhos conectados</strong>
              </li>
              <li>3. Toque em "Conectar um aparelho" e escaneie o QR</li>
            </ol>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="text-xs"
            >
              <XCircle className="mr-1.5 h-3.5 w-3.5" />
              Cancelar pareamento
            </Button>
          </div>
        )}

        {stage === 'connected' && connectedInfo && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Conectado!</p>
              {connectedInfo.name && (
                <p className="text-xs text-muted-foreground">{connectedInfo.name}</p>
              )}
              <p className="font-mono text-xs text-muted-foreground">
                <Smartphone className="mr-1 inline h-3 w-3" />+{connectedInfo.phone}
              </p>
            </div>
            <Button onClick={handleClose}>Concluir</Button>
          </div>
        )}

        {stage === 'error' && (
          <div className="flex flex-col gap-3 py-2">
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error ?? 'Erro desconhecido'}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              <Button onClick={() => setStage('name')}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Tentar de novo
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
