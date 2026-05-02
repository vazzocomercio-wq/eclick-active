'use client';

import { ExternalLink, Mail, Phone, Sparkles } from 'lucide-react';
import type { ConversationDetail } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { InitialsAvatar } from '@/components/contacts/initials-avatar';
import { TemperatureBadge } from '@/components/contacts/temperature-badge';
import { ScoreBar } from '@/components/contacts/score-bar';
import { TagPills } from '@/components/contacts/tag-pills';
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
          <InitialsAvatar
            name={contact.name}
            src={contact.avatar_url}
            className="h-16 w-16 text-base"
          />
          <div>
            <h3 className="text-base font-semibold">
              {contact.name ?? <span className="italic text-muted-foreground">sem nome</span>}
            </h3>
            <p className="text-xs text-muted-foreground">
              {contact.phone ? formatPhone(contact.phone) : '—'}
            </p>
          </div>
        </div>

        {/* Info */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs">Contato</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Row icon={Phone} label="Telefone" value={contact.phone ? formatPhone(contact.phone) : null} />
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
              {conversation.ai_summary ?? contact.tags?.length
                ? conversation.ai_summary
                : 'Sem resumo gerado ainda. A IA gera após algumas trocas de mensagem.'}
            </p>
          </CardContent>
        </Card>

        {/* Tags */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs">Tags</CardTitle>
          </CardHeader>
          <CardContent>
            <TagPills tags={contact.tags ?? []} max={20} />
          </CardContent>
        </Card>

        {/* Deals placeholder */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs">Deals vinculados</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground">
              Endpoint <code>GET /contacts/:id/deals</code> ainda não existe.
            </p>
          </CardContent>
        </Card>

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
    </ScrollArea>
  );
}

interface RowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
}

function Row({ icon: Icon, label, value }: RowProps) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="flex-1 truncate text-xs text-foreground">{value ?? '—'}</span>
    </div>
  );
}
