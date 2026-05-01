'use client';

import { Mail, MessageSquare, Phone, Sparkles } from 'lucide-react';
import type { Contact } from '@eclick-active/shared';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InitialsAvatar } from './initials-avatar';
import { TemperatureBadge } from './temperature-badge';
import { ScoreBar } from './score-bar';
import { TagPills } from './tag-pills';
import { formatPhone, formatRelativeTime } from '@/lib/format';

interface ContactDetailSheetProps {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ContactDetailSheet({ contact, open, onOpenChange }: ContactDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-xl">
        {contact && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-4">
                <InitialsAvatar name={contact.name} src={contact.avatar_url} className="h-14 w-14 text-base" />
                <div className="flex-1 min-w-0">
                  <SheetTitle className="truncate">
                    {contact.name ?? <span className="text-muted-foreground">Sem nome</span>}
                  </SheetTitle>
                  <SheetDescription>
                    Atualizado {formatRelativeTime(contact.updated_at)}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="flex flex-col gap-4">
                {/* Info de contato */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Informações</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <InfoRow icon={Phone} label="Telefone" value={contact.phone ? formatPhone(contact.phone) : null} />
                    <InfoRow icon={Mail} label="Email" value={contact.email} />
                  </CardContent>
                </Card>

                {/* Cards de IA / classificação */}
                <div className="grid grid-cols-2 gap-3">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground">Temperatura</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <TemperatureBadge temperature={contact.temperature} />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground">Score</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-semibold tabular-nums">
                          {contact.score}
                        </span>
                        <ScoreBar score={contact.score} showValue={false} />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      Resumo IA
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {contact.ai_summary ?? 'Sem resumo gerado ainda.'}
                    </p>
                  </CardContent>
                </Card>

                {/* Tags */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Tags</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TagPills tags={contact.tags} max={20} />
                  </CardContent>
                </Card>

                {/* Timeline placeholder — endpoint não existe ainda */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Timeline</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      Em breve. Endpoint <code className="text-xs">GET /contacts/:id/timeline</code> ainda não foi implementado no backend.
                    </p>
                  </CardContent>
                </Card>

                {/* Conversas placeholder */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Conversas</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      Em breve. Filtro por <code className="text-xs">contact_id</code> em <code className="text-xs">/conversations</code> ainda não foi adicionado.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>

            <div className="border-t border-border p-4">
              <Button className="w-full" disabled>
                <MessageSquare className="mr-2 h-4 w-4" />
                Enviar mensagem (em breve)
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

interface InfoRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
}

function InfoRow({ icon: Icon, label, value }: InfoRowProps) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-xs text-muted-foreground w-20">{label}</span>
      <span className="flex-1 truncate text-foreground">{value ?? '—'}</span>
    </div>
  );
}
