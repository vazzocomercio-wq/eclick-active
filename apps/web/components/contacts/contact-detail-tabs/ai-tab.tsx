'use client';

import { useTranslations } from 'next-intl';
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
  const t = useTranslations('contacts.aiTab');
  const objections = (contact.tags ?? []).filter((tag) =>
    /(obje|barreira|preo|caro|sem.budget|n[ãa]o.tem|cancel|hesit)/i.test(tag),
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Resumo IA */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {t('summaryTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {contact.ai_summary ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {contact.ai_summary}
            </p>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              {t('summaryEmpty')}
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
              {t('temperatureTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 pt-0">
            <TemperatureBadge temperature={contact.temperature} />
            <p className="text-[10px] text-muted-foreground">
              {contact.temperature
                ? t(`tempExplanations.${contact.temperature}`)
                : t('tempExplanations.none')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs">{t('scoreTitle')}</CardTitle>
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
          <CardTitle className="text-xs">{t('objectionsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {objections.length > 0 ? (
            <TagPills tags={objections} max={20} />
          ) : (
            <p className="text-[11px] italic text-muted-foreground">
              {t('objectionsEmptyPre')}{' '}
              <code className="text-[10px]">{t('objectionsExampleA')}</code> {t('objectionsExampleConnector')}{' '}
              <code className="text-[10px]">{t('objectionsExampleB')}</code> {t('objectionsEmptyPost')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Histórico de temperatura — placeholder MVP */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs">{t('historyTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-[11px] italic text-muted-foreground">
            {t('historyHintPre')}{' '}
            <code className="text-[10px]">{t('historyEventA')}</code> {t('historyEventConnector')}{' '}
            <code className="text-[10px]">{t('historyEventB')}</code>{t('historyHintPost')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
