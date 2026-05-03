'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Mail, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Preset = 'gmail' | 'outlook' | 'yahoo' | 'custom';

const PRESET_CONFIG: Record<
  Exclude<Preset, 'custom'>,
  {
    smtp_host: string;
    smtp_port: number;
    imap_host: string;
    imap_port: number;
    imap_tls: boolean;
    label: string;
    note?: string;
  }
> = {
  gmail: {
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    imap_host: 'imap.gmail.com',
    imap_port: 993,
    imap_tls: true,
    label: 'Gmail',
    note: 'Use Senha de App em vez da senha normal. Gere em myaccount.google.com/apppasswords',
  },
  outlook: {
    smtp_host: 'smtp-mail.outlook.com',
    smtp_port: 587,
    imap_host: 'outlook.office365.com',
    imap_port: 993,
    imap_tls: true,
    label: 'Outlook / Hotmail',
  },
  yahoo: {
    smtp_host: 'smtp.mail.yahoo.com',
    smtp_port: 465,
    imap_host: 'imap.mail.yahoo.com',
    imap_port: 993,
    imap_tls: true,
    label: 'Yahoo',
    note: 'Yahoo exige Senha de App. Gere em login.yahoo.com/account/security',
  },
};

interface ConnectEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}

export function ConnectEmailDialog({ open, onOpenChange, onConnected }: ConnectEmailDialogProps) {
  const [preset, setPreset] = useState<Preset>('gmail');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState(993);
  const [imapTls, setImapTls] = useState(true);
  const [folder, setFolder] = useState('INBOX');
  const [useTemplate, setUseTemplate] = useState(true);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  // Reset state on open
  useEffect(() => {
    if (!open) return;
    setEmail('');
    setPassword('');
    setDisplayName('');
    setPreset('gmail');
    setFolder('INBOX');
    setUseTemplate(true);
    setTestResult(null);
  }, [open]);

  // Auto-fill custom fields quando preset muda
  useEffect(() => {
    if (preset === 'custom') {
      setSmtpHost('');
      setImapHost('');
      return;
    }
    const cfg = PRESET_CONFIG[preset];
    setSmtpHost(cfg.smtp_host);
    setSmtpPort(cfg.smtp_port);
    setImapHost(cfg.imap_host);
    setImapPort(cfg.imap_port);
    setImapTls(cfg.imap_tls);
  }, [preset]);

  function buildPayload() {
    const base = {
      email: email.trim().toLowerCase(),
      password,
      display_name: displayName.trim() || email,
      folder,
      use_template: useTemplate,
    };
    if (preset === 'custom') {
      return {
        ...base,
        preset,
        smtp_host: smtpHost,
        smtp_port: smtpPort,
        imap_host: imapHost,
        imap_port: imapPort,
        imap_tls: imapTls,
      };
    }
    return { ...base, preset };
  }

  async function handleTest() {
    if (!email || !password) {
      toast.error('Preencha email e senha');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post<{ ok: boolean; error?: string; details?: Record<string, unknown> }>(
        '/channels/email/test',
        buildPayload(),
      );
      setTestResult(res);
      if (res.ok) {
        toast.success('Conexão OK!', { description: 'SMTP + IMAP validados.' });
      } else {
        toast.error('Conexão falhou', { description: res.error });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'erro';
      setTestResult({ ok: false, error: msg });
      toast.error('Falha no teste', { description: msg });
    } finally {
      setTesting(false);
    }
  }

  async function handleConnect() {
    if (!email || !password || !displayName) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }
    setConnecting(true);
    try {
      await api.post<{ channel_id: string }>('/channels/email/connect', buildPayload());
      toast.success('Email conectado!', {
        description: 'Polling iniciado — emails aparecem na inbox em até 60 segundos.',
      });
      onConnected();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'erro';
      toast.error('Falha ao conectar', { description: msg });
    } finally {
      setConnecting(false);
    }
  }

  const isCustom = preset === 'custom';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-blue-500" />
            Conectar Email
          </DialogTitle>
          <DialogDescription>
            Configure SMTP (envio) + IMAP (recebimento). Suas mensagens aparecem na Inbox
            unificada e a IA classifica/sugere respostas igual aos outros canais.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Provedor</Label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as Preset)}
              className={cn(
                'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring',
              )}
            >
              <option value="gmail">Gmail</option>
              <option value="outlook">Outlook / Hotmail</option>
              <option value="yahoo">Yahoo</option>
              <option value="custom">Personalizado (SMTP/IMAP manual)</option>
            </select>
            {!isCustom && PRESET_CONFIG[preset as Exclude<Preset, 'custom'>].note && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
                💡 {PRESET_CONFIG[preset as Exclude<Preset, 'custom'>].note}
              </p>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Email *</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vendas@empresa.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Senha *</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="App password"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Nome de exibição *</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Vazzo Comércio"
              maxLength={100}
            />
            <span className="text-[11px] text-muted-foreground">
              Como aparece no "De:" dos emails que você envia
            </span>
          </div>

          {isCustom && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>SMTP host *</Label>
                  <Input
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="smtp.example.com"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>SMTP port</Label>
                  <Input
                    type="number"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>IMAP host *</Label>
                  <Input
                    value={imapHost}
                    onChange={(e) => setImapHost(e.target.value)}
                    placeholder="imap.example.com"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>IMAP port</Label>
                  <Input
                    type="number"
                    value={imapPort}
                    onChange={(e) => setImapPort(Number(e.target.value))}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={imapTls}
                  onChange={(e) => setImapTls(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>IMAP usa TLS</span>
              </label>
            </>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Pasta IMAP</Label>
              <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="INBOX" />
            </div>
            <label className="flex items-end gap-2 pb-2 text-xs">
              <input
                type="checkbox"
                checked={useTemplate}
                onChange={(e) => setUseTemplate(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              <span>Envolver emails em template HTML estilizado</span>
            </label>
          </div>

          {testResult && (
            <div
              className={cn(
                'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
                testResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                  : 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300',
              )}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0" />
              )}
              <span>{testResult.ok ? 'SMTP + IMAP validados com sucesso.' : testResult.error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testing || connecting || !email || !password}
          >
            {testing && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Testar conexão
          </Button>
          <Button onClick={handleConnect} disabled={connecting || !email || !password || !displayName}>
            {connecting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Conectar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
