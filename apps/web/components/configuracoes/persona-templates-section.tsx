'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PersonaTemplate } from '@eclick-active/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { aiPersonaApi } from '@/lib/api/ai-persona';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/**
 * Section de Configurações > Agente IA > Templates por nicho.
 * Lista templates pré-configurados e permite aplicar com 1 click.
 *
 * Aplicar template:
 *   - Atualiza persona default (nome, tom, guidelines, greeting, etc.)
 *   - Mergeia business_context em organizations.settings.ai_concierge
 *   - (opcional) Cria appointment_types do template (com custom_fields)
 *
 * Idempotente — aplicar 2x não duplica appointment_types.
 */
export function PersonaTemplatesSection() {
  const [templates, setTemplates] = useState<PersonaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PersonaTemplate | null>(null);

  useEffect(() => {
    setLoading(true);
    aiPersonaApi
      .listTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-cyan-500" />
          <CardTitle className="text-base">Templates por nicho</CardTitle>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Configure persona, contexto do Concierge e tipos de agendamento de
          uma vez só. Cada template é otimizado pra um tipo de negócio.
        </p>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando templates…
          </div>
        ) : templates.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            Nenhum template disponível.
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onClick={() => setSelected(t)}
              />
            ))}
          </div>
        )}
      </CardContent>

      <ApplyTemplateDialog
        template={selected}
        onClose={() => setSelected(null)}
        onApplied={() => setSelected(null)}
      />
    </Card>
  );
}

function TemplateCard({
  template,
  onClick,
}: {
  template: PersonaTemplate;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col gap-1.5 rounded-md border border-border bg-card p-3 text-left transition-colors',
        'hover:border-cyan-500/40 hover:bg-cyan-500/5',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-2xl leading-none">{template.emoji}</span>
        <span className="text-sm font-semibold">{template.name}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {template.description}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        <Pill label={`${template.suggested_specialties.length} specialties`} />
        <Pill
          label={`${template.suggested_appointment_types.length} tipo${
            template.suggested_appointment_types.length === 1 ? '' : 's'
          } de agendamento`}
        />
      </div>
    </button>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
      {label}
    </span>
  );
}

function ApplyTemplateDialog({
  template,
  onClose,
  onApplied,
}: {
  template: PersonaTemplate | null;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [createTypes, setCreateTypes] = useState(true);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<{
    appointment_types_created: number;
  } | null>(null);

  useEffect(() => {
    if (template) {
      setCreateTypes(true);
      setDone(null);
      setApplying(false);
    }
  }, [template]);

  async function handleApply() {
    if (!template) return;
    setApplying(true);
    try {
      const res = await aiPersonaApi.applyTemplate({
        template_id: template.id,
        create_appointment_types: createTypes,
      });
      setDone({
        appointment_types_created: res.applied.appointment_types_created,
      });
      toast.success('Template aplicado', {
        description: `Persona "${res.persona.name}" configurada` +
          (res.applied.appointment_types_created > 0
            ? ` + ${res.applied.appointment_types_created} tipo(s) de agendamento criado(s)`
            : ''),
      });
    } catch (err) {
      toast.error('Falha ao aplicar', {
        description: err instanceof ApiError ? err.message : 'Erro desconhecido',
      });
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={!!template} onOpenChange={(o) => !applying && !o && onClose()}>
      <DialogContent className="max-w-xl">
        {template && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="text-2xl">{template.emoji}</span>
                {template.name}
              </DialogTitle>
              <DialogDescription>{template.description}</DialogDescription>
            </DialogHeader>

            {done ? (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
                <span className="text-sm font-semibold">Template aplicado!</span>
                <p className="text-xs text-muted-foreground">
                  Persona "{template.persona.name}" configurada com tom{' '}
                  {template.persona.tone}, {template.persona.guidelines.length}{' '}
                  diretrizes e contexto do negócio definido.
                  {done.appointment_types_created > 0 && (
                    <>
                      <br />
                      {done.appointment_types_created} tipo(s) de agendamento
                      criados em /configuracoes &gt; Agenda.
                    </>
                  )}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3 text-xs">
                {/* Preview da persona */}
                <Section title="Persona">
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <Field label="Nome" value={template.persona.name} />
                    <Field
                      label="Tom"
                      value={tonePtBR(template.persona.tone)}
                    />
                  </div>
                  <div className="mt-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Personalidade
                    </span>
                    <p className="mt-0.5 leading-relaxed">
                      {template.persona.personality}
                    </p>
                  </div>
                </Section>

                {/* Diretrizes */}
                <Section title={`Diretrizes (${template.persona.guidelines.length})`}>
                  <ul className="ml-4 list-disc space-y-0.5 text-[11px]">
                    {template.persona.guidelines.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </Section>

                {/* Specialties */}
                <Section
                  title={`Sugestão de specialties (${template.suggested_specialties.length})`}
                >
                  <div className="flex flex-wrap gap-1">
                    {template.suggested_specialties.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-700 dark:text-cyan-300"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] italic text-muted-foreground">
                    Apenas referência — defina quais cada profissional atende
                    em /equipe.
                  </p>
                </Section>

                {/* Appointment types */}
                {template.suggested_appointment_types.length > 0 && (
                  <Section
                    title={`Tipos de agendamento (${template.suggested_appointment_types.length})`}
                  >
                    <div className="flex flex-col gap-1">
                      {template.suggested_appointment_types.map((t) => (
                        <div
                          key={t.name}
                          className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-[11px]"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: t.color }}
                            />
                            <span className="font-medium">{t.name}</span>
                            <span className="text-[10px] text-muted-foreground">
                              · {t.duration_minutes}min · {t.location_type}
                            </span>
                          </div>
                          {t.custom_fields_schema.length > 0 && (
                            <span className="text-[10px] italic text-muted-foreground">
                              {t.custom_fields_schema.length} campo(s) personalizado(s)
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    <label className="mt-2 flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={createTypes}
                        onChange={(e) => setCreateTypes(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-input"
                      />
                      <span className="text-[11px]">
                        Criar esses tipos de agendamento agora{' '}
                        <span className="text-muted-foreground">
                          (não duplica os já existentes)
                        </span>
                      </span>
                    </label>
                  </Section>
                )}

                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-300">
                  <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    Aplicar substitui os fields da persona default da org
                    (nome, tom, guidelines, greeting). Specialties dos
                    membros NÃO são alteradas — só sugestão.
                  </span>
                </div>
              </div>
            )}

            <DialogFooter>
              {done ? (
                <Button onClick={onApplied}>Fechar</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={onClose} disabled={applying}>
                    Cancelar
                  </Button>
                  <Button onClick={handleApply} disabled={applying}>
                    {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Aplicar template
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/60 bg-muted/10 p-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </span>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function tonePtBR(tone: string): string {
  switch (tone) {
    case 'formal':
      return 'Formal';
    case 'semiformal':
      return 'Profissional';
    case 'casual':
      return 'Casual';
    case 'friendly':
      return 'Caloroso';
    default:
      return tone;
  }
}
