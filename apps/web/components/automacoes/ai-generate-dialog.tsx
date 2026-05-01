'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  automationsApi,
  type GeneratedAutomation,
} from '@/lib/api/automations';
import { ApiError } from '@/lib/api/client';
import { ActionIcon, TriggerBadge, actionLabel } from './automation-icons';

const PLACEHOLDER = `Ex: Quando um lead novo chegar pelo WhatsApp e perguntar preço, envie a tabela de preços, crie uma tarefa de follow-up para daqui 2 horas e marque como lead quente.`;

interface AiGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

type Step = 'input' | 'preview';

export function AiGenerateDialog({
  open,
  onOpenChange,
  onCreated,
}: AiGenerateDialogProps) {
  const [step, setStep] = useState<Step>('input');
  const [description, setDescription] = useState('');
  const [generated, setGenerated] = useState<GeneratedAutomation | null>(null);
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep('input');
      setDescription('');
      setGenerated(null);
      setError(null);
    }
  }, [open]);

  async function handleGenerate() {
    if (description.trim().length < 10) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await automationsApi.generate(description.trim());
      setGenerated(result);
      setStep('preview');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao gerar automação',
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleCreate(activate: boolean) {
    if (!generated) return;
    setCreating(true);
    setError(null);
    try {
      await automationsApi.create({
        name: generated.name,
        description: generated.description,
        trigger_type: generated.trigger_type,
        trigger_config: generated.trigger_config,
        actions: generated.actions,
        is_active: activate,
        natural_language_source: description.trim(),
      });
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao criar automação',
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !generating && !creating && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Criar automação com IA
          </DialogTitle>
          <DialogDescription>
            {step === 'input'
              ? 'Descreva o que quer automatizar em português. A IA monta a automação pra você.'
              : 'Confira a automação gerada antes de salvar. Você pode ajustar tudo depois.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'input' ? (
          <div className="flex flex-col gap-3">
            <Label className="text-xs">Descrição</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={PLACEHOLDER}
              rows={6}
              autoFocus
              className="text-sm leading-relaxed"
            />
            <p className="text-[11px] text-muted-foreground">
              Inclua o disparador, as ações em ordem e qualquer detalhe importante (canal, prioridade, prazo).
            </p>

            {error && (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={generating}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={generating || description.trim().length < 10}
              >
                {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {generating ? 'Gerando...' : 'Gerar'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          generated && (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                <h3 className="text-sm font-semibold">{generated.name}</h3>
                {generated.description && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {generated.description}
                  </p>
                )}
              </div>

              <section className="flex flex-col gap-2">
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Disparador
                </h4>
                <div className="flex items-center gap-2">
                  <TriggerBadge type={generated.trigger_type} />
                  {Object.keys(generated.trigger_config).length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {summarizeTriggerConfig(generated.trigger_config)}
                    </span>
                  )}
                </div>
              </section>

              <section className="flex flex-col gap-2">
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Ações ({generated.actions.length})
                </h4>
                {generated.actions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    A IA não gerou ações — descreva com mais detalhe.
                  </p>
                ) : (
                  <ol className="flex flex-col gap-1.5">
                    {generated.actions.map((a, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 rounded-md border border-border bg-background/50 p-2.5"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums">
                          {i + 1}
                        </span>
                        <ActionIcon type={a.type} className="mt-0.5 shrink-0" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="text-xs font-medium">{actionLabel(a.type)}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {summarizeAction(a)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              {error && (
                <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}

              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setStep('input')}
                  disabled={creating}
                >
                  <ArrowLeft className="mr-2 h-3.5 w-3.5" />
                  Ajustar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleCreate(false)}
                  disabled={creating}
                >
                  {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Criar desativada
                </Button>
                <Button onClick={() => handleCreate(true)} disabled={creating}>
                  {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Criar e ativar
                </Button>
              </DialogFooter>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

function summarizeTriggerConfig(cfg: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(cfg)) {
    if (v === null || v === undefined || v === '') continue;
    parts.push(`${k}: ${String(v)}`);
  }
  return parts.join(' · ');
}

function summarizeAction(a: GeneratedAutomation['actions'][number]): string {
  switch (a.type) {
    case 'send_message':
      return a.text ? truncate(a.text, 80) : 'Mensagem em branco';
    case 'create_task':
      return [a.title, a.due_in_hours ? `em ${a.due_in_hours}h` : null]
        .filter(Boolean)
        .join(' · ') || 'Tarefa';
    case 'move_deal':
      return a.to_stage_id ? `para stage ${a.to_stage_id.slice(0, 8)}…` : 'Mover deal';
    case 'update_contact': {
      const parts = [];
      if (a.add_tags?.length) parts.push(`+${a.add_tags.join(', ')}`);
      if (a.remove_tags?.length) parts.push(`-${a.remove_tags.join(', ')}`);
      if (a.temperature) parts.push(`temp: ${a.temperature}`);
      return parts.join(' · ') || 'Atualizar contato';
    }
    case 'assign_conversation':
      return a.assigned_to ? `para ${a.assigned_to.slice(0, 8)}…` : 'Atribuir';
    case 'notify_agent':
      return a.message ? truncate(a.message, 80) : 'Notificação';
    case 'wait':
      return `${a.minutes ?? 0} minuto${a.minutes === 1 ? '' : 's'}`;
    default:
      return '—';
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
