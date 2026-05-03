'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  HelpCircle,
  Loader2,
  MessageSquarePlus,
  Search,
  Send,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Contact } from '@eclick-active/shared';
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
import { ChannelIcon } from '@/components/ui/channel-icon';
import { contactsApi } from '@/lib/api/contacts';
import { channelsApi, type ChannelView } from '@/lib/api/channels';
import {
  conversationsApi,
  type StartConversationResponse,
} from '@/lib/api/conversations';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface StartConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Disparado quando a conversa é criada/reusada — recebe a resposta. */
  onStarted: (resp: StartConversationResponse) => void;
  /**
   * Se vier, pula a etapa de busca e já carrega esse contato direto.
   * Usado quando o dialog é aberto a partir de um Contact/Deal Sheet.
   */
  initialContactId?: string;
}

interface CompatibleChannel {
  channel: ChannelView;
  reason: 'ok' | 'unverified_whatsapp' | 'no_phone' | 'no_email' | 'no_ig';
}

/**
 * Dialog "Nova conversa" — vendedor escolhe contato + canal + escreve a
 * primeira mensagem. Reaproveita conversa existente se houver
 * (mesmo contato + mesmo canal).
 *
 * Fluxo:
 *  1. Pesquisa contato (ContactPicker inline com debounce)
 *  2. Mostra canais disponíveis filtrando por compatibilidade do contato
 *     (WhatsApp pede phone, email pede email, etc)
 *  3. Textarea de mensagem
 *  4. Submit → POST /conversations/start → onStarted callback
 */
export function StartConversationDialog({
  open,
  onOpenChange,
  onStarted,
  initialContactId,
}: StartConversationDialogProps) {
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [verifying, setVerifying] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setSearchQ('');
      setSearchResults([]);
      setSelectedContact(null);
      setSelectedChannelId(null);
      setMessage('');
      setSubmitting(false);
      setVerifying(false);
      // Foca o input depois do dialog renderizar (só se não tem contato pré-selecionado)
      if (!initialContactId) {
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    }
  }, [open, initialContactId]);

  // Pré-carrega contato quando initialContactId vem preenchido
  useEffect(() => {
    if (!open || !initialContactId) return;
    let cancelled = false;
    contactsApi
      .get(initialContactId)
      .then((c) => {
        if (!cancelled) setSelectedContact(c);
      })
      .catch(() => {
        if (!cancelled) {
          toast.error('Falha ao carregar contato');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialContactId]);

  // Carrega canais (1x ao montar)
  useEffect(() => {
    let mounted = true;
    setChannelsLoading(true);
    channelsApi
      .list()
      .then((list) => {
        if (!mounted) return;
        setChannels(list.filter((c) => c.status === 'active'));
      })
      .catch(() => {
        if (mounted) setChannels([]);
      })
      .finally(() => {
        if (mounted) setChannelsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Search debounced
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = searchQ.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const ctrl = new AbortController();
    debounceRef.current = setTimeout(() => {
      contactsApi
        .search(trimmed, 10, ctrl.signal)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      ctrl.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQ]);

  // Calcula canais compatíveis com o contato selecionado
  const compatible: CompatibleChannel[] = useMemo(() => {
    if (!selectedContact) return [];
    return channels.map((ch) => {
      const t = ch.channel_type;
      if (t === 'whatsapp' || t === 'whatsapp_free') {
        if (!selectedContact.phone) {
          return { channel: ch, reason: 'no_phone' };
        }
        if (t === 'whatsapp_free' && selectedContact.whatsapp_verified === false) {
          // Só whatsapp_free é estrito — Z-API tenta enviar mesmo se não verificou
          return { channel: ch, reason: 'unverified_whatsapp' };
        }
        return { channel: ch, reason: 'ok' };
      }
      if (t === 'email') {
        return { channel: ch, reason: selectedContact.email ? 'ok' : 'no_email' };
      }
      if (t === 'instagram') {
        const ig = (selectedContact.channel_profiles ?? {})['instagram'] as
          | { ig_id?: string }
          | undefined;
        return { channel: ch, reason: ig?.ig_id ? 'ok' : 'no_ig' };
      }
      return { channel: ch, reason: 'ok' };
    });
  }, [selectedContact, channels]);

  // Auto-seleciona o primeiro canal compatível quando contato muda
  useEffect(() => {
    const first = compatible.find((c) => c.reason === 'ok');
    setSelectedChannelId(first ? first.channel.id : null);
  }, [compatible]);

  async function handleVerifyWhatsApp() {
    if (!selectedContact) return;
    setVerifying(true);
    try {
      const res = await contactsApi.verifyWhatsapp(selectedContact.id);
      if (res.ok && res.result) {
        // Atualiza contato local com resultado fresco
        setSelectedContact({
          ...selectedContact,
          whatsapp_verified: res.result.exists,
          whatsapp_jid: res.result.jid ?? null,
          whatsapp_profile_name: res.result.profile_name ?? null,
          whatsapp_profile_pic_url: res.result.profile_pic_url ?? null,
        });
        toast.success(
          res.result.exists ? 'Número verificado como WhatsApp' : 'Número não é WhatsApp',
        );
      } else {
        toast.warning('Não foi possível verificar agora. Conecte um canal WhatsApp.');
      }
    } catch (err) {
      toast.error('Falha ao verificar', {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setVerifying(false);
    }
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedContact || !selectedChannelId || !message.trim()) return;
    setSubmitting(true);
    try {
      const res = await conversationsApi.start({
        contact_id: selectedContact.id,
        channel_id: selectedChannelId,
        message: message.trim(),
      });
      if (res.reused) {
        toast.info('Conversa existente — abrindo', {
          description: selectedContact.name ?? selectedContact.phone ?? '',
        });
      } else {
        toast.success(
          `Conversa iniciada com ${selectedContact.name ?? selectedContact.phone ?? 'contato'}`,
        );
      }
      // Se a mensagem falhou no envio, alerta mas não bloqueia
      if (res.message.status === 'failed') {
        toast.warning('Mensagem falhou no envio', {
          description: res.message.error_message ?? 'Verifique o canal e tente reenviar pelo chat.',
        });
      }
      onStarted(res);
      onOpenChange(false);
    } catch (err) {
      toast.error('Falha ao iniciar conversa', {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500/30 to-blue-500/30 text-cyan-300">
              <MessageSquarePlus className="h-4 w-4" />
            </span>
            Nova conversa
          </DialogTitle>
          <DialogDescription>
            Pesquise um contato, escolha o canal e escreva a primeira mensagem.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleStart} className="flex flex-col gap-4">
          {/* Etapa 1 — Selecionar contato */}
          {!selectedContact ? (
            <div className="flex flex-col gap-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Contato
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={inputRef}
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Busque por nome, telefone ou e-mail"
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-background/40">
                {searching && (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                )}
                {!searching && searchResults.length === 0 && searchQ.trim().length >= 2 && (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Nenhum contato encontrado
                  </div>
                )}
                {!searching && searchResults.length === 0 && searchQ.trim().length < 2 && (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Digite pelo menos 2 caracteres
                  </div>
                )}
                {searchResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedContact(c)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted transition-colors"
                  >
                    <Avatar contact={c} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {c.name ?? 'Sem nome'}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {c.phone && (
                          <span className="flex items-center gap-1">
                            {c.phone}
                            <WhatsAppDot verified={c.whatsapp_verified} />
                          </span>
                        )}
                        {c.email && <span>· {c.email}</span>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <SelectedContactCard
              contact={selectedContact}
              onClear={() => {
                setSelectedContact(null);
                setSearchQ('');
              }}
              onVerify={handleVerifyWhatsApp}
              verifying={verifying}
            />
          )}

          {/* Etapa 2 — Canal */}
          {selectedContact && (
            <div className="flex flex-col gap-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Canal
              </Label>
              {channelsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Carregando canais…
                </div>
              ) : compatible.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  Nenhum canal ativo. Conecte um canal em Configurações.
                </div>
              ) : compatible.every((c) => c.reason !== 'ok') ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Este contato não tem identificador para nenhum canal ativo.
                  Adicione telefone ou e-mail antes de iniciar conversa.
                </div>
              ) : (
                <div className="grid gap-1.5">
                  {compatible.map(({ channel, reason }) => {
                    const ok = reason === 'ok';
                    const active = selectedChannelId === channel.id;
                    return (
                      <button
                        key={channel.id}
                        type="button"
                        disabled={!ok}
                        onClick={() => setSelectedChannelId(channel.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                          active
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-background hover:border-primary/40',
                          !ok && 'cursor-not-allowed opacity-50',
                        )}
                      >
                        <ChannelIcon type={channel.channel_type} size="sm" />
                        <span className="flex-1 font-medium">{channel.name}</span>
                        {!ok && (
                          <span className="text-[10px] text-muted-foreground">
                            {reasonLabel(reason)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Etapa 3 — Mensagem */}
          {selectedContact && selectedChannelId && (
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="start-msg"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Primeira mensagem
              </Label>
              <textarea
                id="start-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Escreva a mensagem que vai abrir essa conversa…"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                maxLength={4096}
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{message.length} / 4096</span>
                <span>Enter manda nova linha · Ctrl+Enter envia</span>
              </div>
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end gap-2">
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
                submitting ||
                !selectedContact ||
                !selectedChannelId ||
                message.trim().length === 0
              }
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Iniciar conversa
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function reasonLabel(r: CompatibleChannel['reason']): string {
  switch (r) {
    case 'no_phone':
      return 'sem telefone';
    case 'no_email':
      return 'sem e-mail';
    case 'no_ig':
      return 'sem perfil IG';
    case 'unverified_whatsapp':
      return 'número não é WhatsApp';
    default:
      return '';
  }
}

function Avatar({ contact }: { contact: Contact }) {
  const url = contact.avatar_url ?? contact.whatsapp_profile_pic_url ?? null;
  const initials = (contact.name ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        className="h-9 w-9 rounded-full object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">
      {initials || '?'}
    </div>
  );
}

function WhatsAppDot({ verified }: { verified: boolean | null }) {
  if (verified === true) {
    return <CheckCircle2 className="h-3 w-3 text-emerald-400" aria-label="WhatsApp verificado" />;
  }
  if (verified === false) {
    return <XCircle className="h-3 w-3 text-rose-400" aria-label="Não é WhatsApp" />;
  }
  return <HelpCircle className="h-3 w-3 text-muted-foreground" aria-label="Não verificado" />;
}

function SelectedContactCard({
  contact,
  onClear,
  onVerify,
  verifying,
}: {
  contact: Contact;
  onClear: () => void;
  onVerify: () => void;
  verifying: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-background/40 p-3">
      <Avatar contact={contact} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{contact.name ?? 'Sem nome'}</div>
        {contact.phone && (
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{contact.phone}</span>
            <WhatsAppDot verified={contact.whatsapp_verified} />
            {contact.whatsapp_verified === null && (
              <button
                type="button"
                onClick={onVerify}
                disabled={verifying}
                className="text-[10px] underline hover:text-foreground"
              >
                {verifying ? 'verificando…' : 'verificar agora'}
              </button>
            )}
          </div>
        )}
        {contact.email && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">{contact.email}</div>
        )}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        Trocar
      </Button>
    </div>
  );
}
