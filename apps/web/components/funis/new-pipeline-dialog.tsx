'use client';

import { useEffect, useState } from 'react';
import {
  Briefcase,
  GraduationCap,
  Home,
  Layers,
  Loader2,
  ShoppingCart,
  Stethoscope,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  pipelinesApi,
  type PipelineTemplateKey,
  type PipelineTemplateMeta,
  type PipelineWithStages,
} from '@/lib/api/pipelines';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  'shopping-cart': ShoppingCart,
  stethoscope: Stethoscope,
  home: Home,
  'graduation-cap': GraduationCap,
  briefcase: Briefcase,
  sun: Sun,
};

interface NewPipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Disparado após criar — pai recarrega a lista. */
  onCreated: (pipeline: PipelineWithStages | { id: string; name: string }) => void;
}

type Mode = 'choose' | 'blank' | 'template';

/**
 * Dialog "Novo pipeline" com 2 fluxos:
 *   1. "Em branco" — cria pipeline vazio, user adiciona stages manualmente
 *   2. "Usar template" — grid de cards por segmento; cria pipeline + stages
 *      pré-configurados via POST /pipelines/from-template
 *
 * Estado interno é mode: 'choose' (tela inicial) → 'blank' ou 'template'.
 */
export function NewPipelineDialog({ open, onOpenChange, onCreated }: NewPipelineDialogProps) {
  const [mode, setMode] = useState<Mode>('choose');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [templates, setTemplates] = useState<PipelineTemplateMeta[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PipelineTemplateKey | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Reset ao reabrir
  useEffect(() => {
    if (!open) return;
    setMode('choose');
    setName('');
    setSelectedTemplate(null);
  }, [open]);

  // Lazy load templates só quando vai pra aba template
  useEffect(() => {
    if (mode !== 'template' || templates.length > 0 || loadingTemplates) return;
    setLoadingTemplates(true);
    pipelinesApi
      .listTemplates()
      .then(setTemplates)
      .catch((err) => {
        toast.error('Falha ao carregar templates', { description: extractMessage(err) });
      })
      .finally(() => setLoadingTemplates(false));
  }, [mode, templates.length, loadingTemplates]);

  async function handleCreateBlank(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const p = await pipelinesApi.create({ name: name.trim() });
      toast.success('Pipeline criado');
      onCreated(p);
      onOpenChange(false);
    } catch (err) {
      toast.error('Falha ao criar pipeline', { description: extractMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateFromTemplate() {
    if (!selectedTemplate) return;
    setSubmitting(true);
    try {
      const p = await pipelinesApi.createFromTemplate(
        selectedTemplate,
        name.trim() || undefined,
      );
      toast.success(`Pipeline criado a partir do template "${p.name}"`);
      onCreated(p);
      onOpenChange(false);
    } catch (err) {
      toast.error('Falha ao criar pipeline', { description: extractMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'choose' && 'Novo pipeline'}
            {mode === 'blank' && 'Pipeline em branco'}
            {mode === 'template' && 'Escolher template'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'choose' &&
              'Comece em branco ou use um template pré-configurado pra seu segmento.'}
            {mode === 'blank' && 'Você adicionará as etapas em seguida.'}
            {mode === 'template' &&
              'Templates trazem as etapas mais comuns do segmento. Você pode editar tudo depois.'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'choose' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('blank')}
              className={cn(
                'flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors',
                'hover:border-primary/50 hover:bg-primary/5',
              )}
            >
              <Layers className="h-5 w-5 text-primary" />
              <span className="text-sm font-semibold">Em branco</span>
              <span className="text-xs text-muted-foreground">
                Crie um pipeline do zero e configure as etapas manualmente.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode('template')}
              className={cn(
                'flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors',
                'hover:border-primary/50 hover:bg-primary/5',
              )}
            >
              <Stethoscope className="h-5 w-5 text-primary" />
              <span className="text-sm font-semibold">Usar template</span>
              <span className="text-xs text-muted-foreground">
                E-commerce, clínica, imobiliária, B2B, energia solar, educação.
              </span>
            </button>
          </div>
        )}

        {mode === 'blank' && (
          <form onSubmit={handleCreateBlank} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Nome do pipeline</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Vendas B2B"
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setMode('choose')}
                disabled={submitting}
              >
                Voltar
              </Button>
              <Button type="submit" disabled={!name.trim() || submitting}>
                {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Criar pipeline
              </Button>
            </DialogFooter>
          </form>
        )}

        {mode === 'template' && (
          <div className="flex flex-col gap-3">
            {loadingTemplates ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {templates.map((t) => {
                  const Icon = TEMPLATE_ICONS[t.icon] ?? Layers;
                  const active = selectedTemplate === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => {
                        setSelectedTemplate(t.key);
                        if (!name.trim()) setName(t.default_name);
                      }}
                      className={cn(
                        'flex flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors',
                        active
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/40',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" />
                        <span className="text-sm font-semibold">{t.default_name}</span>
                      </div>
                      <p className="line-clamp-2 text-[11px] text-muted-foreground">
                        {t.description}
                      </p>
                      <div className="flex flex-wrap items-center gap-1">
                        {t.stages.map((s, idx) => (
                          <span
                            key={idx}
                            title={`${s.name} · ${s.probability}%`}
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: s.color }}
                          />
                        ))}
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          {t.stages.length} etapas
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedTemplate && (
              <div className="flex flex-col gap-1 border-t border-border pt-3">
                <Label className="text-xs">Nome do pipeline</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Use o default ou customize"
                />
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setMode('choose')}
                disabled={submitting}
              >
                Voltar
              </Button>
              <Button
                type="button"
                onClick={handleCreateFromTemplate}
                disabled={!selectedTemplate || submitting}
              >
                {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Criar
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function extractMessage(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return 'Erro desconhecido';
}
