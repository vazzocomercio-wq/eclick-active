'use client';

import { useEffect, useState } from 'react';
import {
  CalendarPlus,
  ExternalLink,
  GitBranch,
  Lock,
  Mail,
  Phone,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ConversationDetail } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { AvatarWithChannel } from '@/components/contacts/avatar-with-channel';
import { TemperatureBadge } from '@/components/contacts/temperature-badge';
import { WhatsAppVerifiedBadge } from '@/components/contacts/whatsapp-verified-badge';
import { channelLabel } from '@/components/ui/channel-icon';
import { ScoreBar } from '@/components/contacts/score-bar';
import { TagPicker } from '@/components/tags/tag-picker';
import { NewAppointmentDialog } from '@/components/agenda/new-appointment-dialog';
import { TicketSacSection } from '@/components/sac/ticket-sac-section';
import { contactsApi, type ContactDealItem } from '@/lib/api/contacts';
import { ApiError } from '@/lib/api/client';
import { formatPhone } from '@/lib/format';

interface ContactPanelProps {
  conversation: ConversationDetail | null;
  loading: boolean;
  /**
   * Disparado ao clicar em "Ver perfil completo". O caller (página
   * /conversas) abre o `<ContactDetailSheet>` em resposta. Quando ausente,
   * o botão é renderizado como link `<a href="/contatos">` (fallback).
   */
  onOpenFullProfile?: (contactId: string) => void;
}

export function ContactPanel({ conversation, loading, onOpenFullProfile }: ContactPanelProps) {
  const [appointmentOpen, setAppointmentOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const contact = conversation?.contact;
  if (!contact) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Selecione uma conversa pra ver o contato
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-4">
        {/* Cabeçalho */}
        <div className="flex flex-col items-center gap-2 text-center">
          <AvatarWithChannel
            name={contact.name}
            src={contact.avatar_url}
            channelType={conversation?.channel_type}
            size="lg"
          />
          <div>
            <h3 className="text-base font-semibold">
              {contact.name ?? <span className="italic text-muted-foreground">sem nome</span>}
            </h3>
            <p className="inline-flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              {contact.phone ? formatPhone(contact.phone) : '—'}
              {contact.phone && (
                <WhatsAppVerifiedBadge
                  contactId={contact.id}
                  verified={contact.whatsapp_verified}
                  size="sm"
                />
              )}
            </p>
            {conversation?.channel_type && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                via {channelLabel(conversation.channel_type)}
              </p>
            )}
          </div>
          {/* Ação rápida: agendar */}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setAppointmentOpen(true)}
          >
            <CalendarPlus className="mr-1.5 h-3.5 w-3.5" />
            Novo agendamento
          </Button>
        </div>

        {/* Info */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs">Contato</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Row
              icon={Phone}
              label="Telefone"
              value={contact.phone ? formatPhone(contact.phone) : null}
              extra={
                contact.phone && (
                  <WhatsAppVerifiedBadge
                    contactId={contact.id}
                    verified={contact.whatsapp_verified}
                    size="sm"
                  />
                )
              }
            />
            <Row icon={Mail} label="Email" value={contact.email} />
          </CardContent>
        </Card>

        {/* Cards IA */}
        <div className="grid grid-cols-2 gap-2">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Temperatura
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              <TemperatureBadge temperature={contact.temperature} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Score
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-1 pt-1">
              <span className="text-xl font-semibold tabular-nums">{contact.score}</span>
            </CardContent>
          </Card>
        </div>

        <ScoreBar score={contact.score} showValue={false} />

        {/* Resumo IA */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-xs">
              <Sparkles className="h-3 w-3 text-primary" /> Resumo IA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {conversation.ai_summary
                ? conversation.ai_summary
                : 'Sem resumo gerado ainda. Clique em "Resumir" no chat após algumas mensagens trocadas.'}
            </p>
          </CardContent>
        </Card>

        {/* Tags do contato (editáveis) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs">Tags do contato</CardTitle>
          </CardHeader>
          <CardContent>
            <ContactTagsEditor contact={contact} />
          </CardContent>
        </Card>

        {/* Ticket SAC vinculado (se existir — aparece automaticamente) */}
        {conversation?.id && <TicketSacSection conversationId={conversation.id} />}

        {/* Funil & Etapa atual — deals abertos do contato */}
        <FunnelStageSection contactId={contact.id} />

        {/* Tasks placeholder */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs">Tarefas pendentes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground">
              Endpoint <code>GET /contacts/:id/tasks</code> ainda não existe.
            </p>
          </CardContent>
        </Card>

        {onOpenFullProfile ? (
          <Button
            variant="outline"
            onClick={() => onOpenFullProfile(contact.id)}
          >
            <ExternalLink className="mr-2 h-3.5 w-3.5" />
            Ver perfil completo
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <a href="/contatos">
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Ver perfil completo
            </a>
          </Button>
        )}
      </div>

      <NewAppointmentDialog
        open={appointmentOpen}
        onOpenChange={setAppointmentOpen}
        defaultContactId={contact.id}
        defaultConversationId={conversation?.id}
        onCreated={() => {
          setAppointmentOpen(false);
          toast.success('Agendamento criado');
        }}
      />
    </ScrollArea>
  );
}

// ──────────────────────────────────────────────────────────
// ContactTagsEditor — TagPicker editável dentro do panel
// ──────────────────────────────────────────────────────────

function ContactTagsEditor({ contact }: { contact: NonNullable<ConversationDetail['contact']> }) {
  const [tags, setTags] = useState<string[]>(contact.tags ?? []);

  // Re-sincroniza quando o contato troca (selecionou outra conversa)
  useEffect(() => {
    setTags(contact.tags ?? []);
  }, [contact.id, contact.tags]);

  return (
    <TagPicker
      entityType="contact"
      value={tags}
      onChange={(next) => {
        const prev = tags;
        setTags(next); // optimistic
        contactsApi.update(contact.id, { tags: next }).catch((err) => {
          // Reverte UI em caso de falha
          setTags(prev);
          toast.error('Falha ao salvar tags', {
            description: err instanceof ApiError ? err.message : undefined,
          });
        });
      }}
      placeholder="Adicionar tag…"
    />
  );
}

interface RowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
  /** Conteúdo extra renderizado depois do value (ex: badges) */
  extra?: React.ReactNode;
}

function Row({ icon: Icon, label, value, extra }: RowProps) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="flex-1 truncate text-xs text-foreground">{value ?? '—'}</span>
      {extra}
    </div>
  );
}

/**
 * Mostra os deals abertos do contato com pipeline (funil) + stage (etapa)
 * resolvidos. Quando a stage é marcada `requires_human=true`, mostra
 * badge 🔒 indicando que IA Concierge silencia em deals nessa stage.
 */
function FunnelStageSection({ contactId }: { contactId: string }) {
  const [deals, setDeals] = useState<ContactDealItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    contactsApi
      .getDeals(contactId, ctrl.signal)
      .then((d) => setDeals(d))
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        // Endpoint pode não existir em ambientes legados — falha silenciosa
        setDeals([]);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [contactId]);

  // Deals ativos (não won, não lost) primeiro; fechados embaixo
  const open = (deals ?? []).filter((d) => !d.won_at && !d.lost_at);
  const closed = (deals ?? []).filter((d) => d.won_at || d.lost_at);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-xs">
          <GitBranch className="h-3 w-3 text-primary" /> Funil & Etapa
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : open.length === 0 && closed.length === 0 ? (
          <p className="text-[11px] italic text-muted-foreground">
            Lead ainda não foi roteado pra nenhum funil.
          </p>
        ) : (
          <>
            {open.map((d) => (
              <DealFunnelRow key={d.id} deal={d} />
            ))}
            {closed.length > 0 && (
              <details className="text-[11px] text-muted-foreground">
                <summary className="cursor-pointer select-none hover:text-foreground">
                  Fechados ({closed.length})
                </summary>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {closed.map((d) => (
                    <DealFunnelRow key={d.id} deal={d} closed />
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DealFunnelRow({ deal, closed = false }: { deal: ContactDealItem; closed?: boolean }) {
  const stageColor = deal.stage_color ?? '#00E5FF';
  const closedTag = deal.won_at ? '✓ ganho' : deal.lost_at ? '✕ perdido' : null;

  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 px-2 py-1.5"
      style={closed ? { opacity: 0.6 } : undefined}
    >
      <div className="flex items-center gap-1.5 text-xs">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: stageColor }}
        />
        <span className="truncate font-medium" title={deal.title}>
          {deal.title}
        </span>
        {closedTag && (
          <span className="ml-auto shrink-0 text-[9px] uppercase text-muted-foreground">
            {closedTag}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 pl-3.5 text-[10px] text-muted-foreground">
        <span className="truncate">
          {deal.pipeline_name ?? 'Funil'} · <span style={{ color: stageColor }}>{deal.stage_name ?? 'Etapa'}</span>
        </span>
        {deal.stage_requires_human && (
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-500/15 px-1 text-[9px] font-medium text-amber-700 dark:text-amber-400"
            title="IA silencia nessa etapa — atendimento humano obrigatório"
          >
            <Lock className="h-2.5 w-2.5" /> humano
          </span>
        )}
      </div>
    </div>
  );
}
