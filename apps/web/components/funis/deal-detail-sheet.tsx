'use client';

import { useEffect, useState } from 'react';
import {
  Calendar,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { InitialsAvatar } from '@/components/contacts/initials-avatar';
import { TemperatureBadge } from '@/components/contacts/temperature-badge';
import { FactorBar } from './factor-bar';
import { AIScoreCircle } from './ai-score-circle';
import { RiskPill } from './risk-pill';
import { LostReasonDialog } from './lost-reason-dialog';
import { useDealDetail } from '@/hooks/use-deal-detail';
import { dealsApi, type UpdateDealInput } from '@/lib/api/deals';
import { aiApi, type DealScoreFactors } from '@/lib/api/ai';
import { formatPhone, formatRelativeTime, parseTagsInput } from '@/lib/format';
import type { PipelineWithStages } from '@/lib/api/pipelines';
import { cn } from '@/lib/utils';

interface DealDetailSheetProps {
  dealId: string | null;
  pipeline: PipelineWithStages | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

export function DealDetailSheet({
  dealId,
  pipeline,
  open,
  onOpenChange,
  onChanged,
}: DealDetailSheetProps) {
  const { detail, activities, loading, reload } = useDealDetail(dealId);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [showLostDialog, setShowLostDialog] = useState(false);

  // Form local — pra edits inline simulados
  const [form, setForm] = useState<{
    title: string;
    value: string;
    expected_close_date: string;
    tags: string;
  }>({ title: '', value: '', expected_close_date: '', tags: '' });

  useEffect(() => {
    if (detail) {
      setForm({
        title: detail.title ?? '',
        value: detail.value ? String(detail.value) : '',
        expected_close_date: detail.expected_close_date ?? '',
        tags: (detail.tags ?? []).join(', '),
      });
    }
  }, [detail]);

  if (!dealId) return null;

  async function handleSave() {
    if (!detail) return;
    setSaving(true);
    try {
      const patch: UpdateDealInput = {
        title: form.title.trim(),
        value: form.value ? Number(form.value.replace(',', '.')) : undefined,
        expected_close_date: form.expected_close_date || null,
        tags: parseTagsInput(form.tags),
      };
      await dealsApi.update(detail.id, patch);
      await reload();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function handleMoveToStage(stageId: string) {
    if (!detail) return;
    const target = pipeline?.stages.find((s) => s.id === stageId);
    if (target?.is_lost) {
      setShowLostDialog(true);
      return;
    }
    setSaving(true);
    try {
      await dealsApi.move(detail.id, { stage_id: stageId });
      await reload();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmLost(reason: string) {
    if (!detail) return;
    const lostStage = pipeline?.stages.find((s) => s.is_lost);
    if (!lostStage) return;
    setSaving(true);
    try {
      await dealsApi.move(detail.id, { stage_id: lostStage.id, lost_reason: reason });
      setShowLostDialog(false);
      await reload();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function handleWin() {
    const wonStage = pipeline?.stages.find((s) => s.is_won);
    if (wonStage) await handleMoveToStage(wonStage.id);
  }

  async function handleDelete() {
    if (!detail) return;
    if (!window.confirm('Excluir este deal? A ação não pode ser desfeita.')) return;
    setDeleting(true);
    try {
      await dealsApi.remove(detail.id);
      onOpenChange(false);
      onChanged();
    } finally {
      setDeleting(false);
    }
  }

  async function handleRescore() {
    if (!detail) return;
    setScoring(true);
    try {
      await aiApi.scoreDeal(detail.id);
      await reload();
      onChanged();
    } finally {
      setScoring(false);
    }
  }

  const factors = (detail?.custom_fields as { ai_factors?: DealScoreFactors } | undefined)?.ai_factors;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full max-w-xl">
          <SheetHeader>
            <SheetTitle>Detalhes do negócio</SheetTitle>
            <SheetDescription>
              {loading ? 'Carregando...' : detail?.title ?? '—'}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-4 px-6 py-4">
              {loading || !detail ? (
                <SkeletonView />
              ) : (
                <>
                  {/* Form: título, valor, stage */}
                  <Card>
                    <CardContent className="flex flex-col gap-3 p-4">
                      <Field label="Título">
                        <Input
                          value={form.title}
                          onChange={(e) => setForm({ ...form, title: e.target.value })}
                        />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Valor (R$)">
                          <Input
                            value={form.value}
                            onChange={(e) => setForm({ ...form, value: e.target.value })}
                            inputMode="decimal"
                          />
                        </Field>
                        <Field label="Stage">
                          <select
                            value={detail.stage_id}
                            onChange={(e) => void handleMoveToStage(e.target.value)}
                            disabled={saving}
                            className={cn(
                              'h-10 w-full rounded-md border border-input bg-background px-3 text-sm',
                              'focus:outline-none focus:ring-2 focus:ring-ring',
                            )}
                          >
                            {pipeline?.stages.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Data esperada">
                          <Input
                            type="date"
                            value={form.expected_close_date}
                            onChange={(e) =>
                              setForm({ ...form, expected_close_date: e.target.value })
                            }
                          />
                        </Field>
                        <Field label="Tags" hint="Vírgula entre">
                          <Input
                            value={form.tags}
                            onChange={(e) => setForm({ ...form, tags: e.target.value })}
                            placeholder="lead-quente, b2b"
                          />
                        </Field>
                      </div>
                      <Button onClick={handleSave} disabled={saving} className="self-end">
                        {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                        Salvar
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Contato */}
                  {detail.contact && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-xs">Contato</CardTitle>
                      </CardHeader>
                      <CardContent className="flex items-center gap-3 pt-0">
                        <InitialsAvatar
                          name={detail.contact.name}
                          src={detail.contact.avatar_url}
                          className="h-10 w-10 text-xs"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">
                              {detail.contact.name ?? 'Sem nome'}
                            </span>
                            {detail.contact.temperature && (
                              <TemperatureBadge temperature={detail.contact.temperature} />
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            {detail.contact.phone && (
                              <span className="inline-flex items-center gap-1">
                                <Phone className="h-3 w-3" />
                                {formatPhone(detail.contact.phone)}
                              </span>
                            )}
                            {detail.contact.email && (
                              <span className="inline-flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                {detail.contact.email}
                              </span>
                            )}
                          </div>
                        </div>
                        <Button variant="outline" size="sm" asChild>
                          <Link href="/conversas">
                            <MessageSquare className="mr-1 h-3.5 w-3.5" />
                            Conversa
                          </Link>
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  {/* IA Insights */}
                  <Card className="border-primary/30 bg-primary/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5 text-primary" />
                          Insights IA
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleRescore}
                          disabled={scoring}
                          className="h-7"
                        >
                          <RefreshCw
                            className={cn('mr-1 h-3 w-3', scoring && 'animate-spin')}
                          />
                          Recalcular
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3 pt-0">
                      <div className="flex items-center gap-3">
                        <AIScoreCircle score={detail.ai_score ?? 0} size={56} />
                        <div className="flex flex-col gap-1">
                          <RiskPill risk={detail.ai_risk} />
                          {detail.ai_close_probability !== null && (
                            <span className="text-xs text-muted-foreground">
                              Prob. fechamento:{' '}
                              <span className="font-semibold text-foreground">
                                {detail.ai_close_probability}%
                              </span>
                            </span>
                          )}
                        </div>
                      </div>

                      {detail.ai_next_action && (
                        <div className="rounded-md bg-background/60 px-2 py-1.5 text-xs">
                          <span className="font-semibold">Próxima ação:</span>{' '}
                          {detail.ai_next_action}
                        </div>
                      )}

                      {factors && (
                        <div className="grid grid-cols-2 gap-3">
                          <FactorBar label="Engajamento" value={factors.engagement} />
                          <FactorBar label="Recência" value={factors.recency} />
                          <FactorBar label="Fit" value={factors.fit} />
                          <FactorBar label="Intenção" value={factors.intent} />
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Timeline */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs">Timeline</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {activities.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Sem atividades registradas.</p>
                      ) : (
                        <ul className="flex flex-col gap-2">
                          {activities.slice(0, 20).map((a) => (
                            <li key={a.id} className="flex items-start gap-2 text-xs">
                              <Calendar className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                              <div className="flex-1">
                                <span className="font-medium">{a.title ?? a.activity_type}</span>
                                {a.description && (
                                  <span className="text-muted-foreground"> · {a.description}</span>
                                )}
                                <span className="ml-1 text-muted-foreground">
                                  · {formatRelativeTime(a.created_at)}
                                </span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </ScrollArea>

          {/* Footer com ações */}
          {detail && (
            <div className="flex items-center gap-2 border-t border-border p-3">
              <Button
                onClick={handleWin}
                disabled={saving || detail.won_at !== null}
                className="flex-1 bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                <TrendingUp className="mr-1 h-3.5 w-3.5" />
                Ganho
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowLostDialog(true)}
                disabled={saving || detail.lost_at !== null}
                className="flex-1"
              >
                <TrendingDown className="mr-1 h-3.5 w-3.5" />
                Perdido
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDelete}
                disabled={deleting}
                aria-label="Excluir"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <LostReasonDialog
        open={showLostDialog}
        onConfirm={handleConfirmLost}
        onCancel={() => setShowLostDialog(false)}
      />
    </>
  );
}

function SkeletonView() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-32" />
      <Skeleton className="h-20" />
      <Skeleton className="h-40" />
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
