'use client';

import { Sparkles, ThermometerSun } from 'lucide-react';
import type { Contact } from '@eclick-active/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TemperatureBadge } from '@/components/contacts/temperature-badge';
import { ScoreBar } from '@/components/contacts/score-bar';
import { TagPills } from '@/components/contacts/tag-pills';

interface ContactAITabProps {
  contact: Contact;
}

/**
 * Aba "IA" do Contact Detail Sheet — apresenta tudo o que a IA sabe sobre
 * o contato:
 *   - ai_summary (resumo gerado)
 *   - Temperatura atual (a tabela contact_timeline poderia ter histórico
 *     com event_type='score_changed' / 'ai_insight'; pra MVP, mostramos só
 *     o estado atual + tags como pseudo-objeções)
 *   - Score com barra
 *   - Objeções detectadas: como ainda não há campo dedicado,
 *     reaproveitamos as tags que parecem objeção (heurística leve)
 */
export function ContactAITab({ contact }: ContactAITabProps) {
  const objections = (contact.tags ?? []).filter((t) =>
    /(obje|barreira|preo|caro|sem.budget|n[ãa]o.tem|cancel|hesit)/i.test(t),
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Resumo IA */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Resumo IA
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {contact.ai_summary ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {contact.ai_summary}
            </p>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              Sem resumo ainda. A IA gera um resumo após algumas trocas de mensagem.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Temperatura + Score */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-xs">
              <ThermometerSun className="h-3 w-3 text-orange-500" />
              Temperatura
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 pt-0">
            <TemperatureBadge temperature={contact.temperature} />
            <p className="text-[10px] text-muted-foreground">
              {temperatureExplanation(contact.temperature)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs">Score</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 pt-0">
            <span className="text-2xl font-semibold tabular-nums">
              {contact.score}
              <span className="text-sm text-muted-foreground">/100</span>
            </span>
            <ScoreBar score={contact.score} showValue={false} />
          </CardContent>
        </Card>
      </div>

      {/* Objeções (heurística sobre tags) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs">Objeções detectadas</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {objections.length > 0 ? (
            <TagPills tags={objections} max={20} />
          ) : (
            <p className="text-[11px] italic text-muted-foreground">
              Sem objeções marcadas via tags. Adicione tags como{' '}
              <code className="text-[10px]">objecao-preco</code> ou{' '}
              <code className="text-[10px]">sem-budget</code> pra rastrear aqui.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Histórico de temperatura — placeholder MVP */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs">Histórico de temperatura</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-[11px] italic text-muted-foreground">
            Histórico detalhado vem da timeline na próxima aba (eventos{' '}
            <code className="text-[10px]">score_changed</code> e{' '}
            <code className="text-[10px]">ai_insight</code>).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

const TEMP_EXPLANATIONS: Record<NonNullable<Contact['temperature']>, string> = {
  cold: 'Sem engajamento recente. Reativar via campanha ou follow-up.',
  warm: 'Demonstra interesse. Manter cadência de contato.',
  hot: 'Alto engajamento. Acelerar próxima ação.',
  very_hot: 'Pronto pra fechar. Priorize esta conversa hoje.',
};

function temperatureExplanation(t: Contact['temperature']): string {
  if (!t) return 'Não classificada ainda.';
  return TEMP_EXPLANATIONS[t];
}
