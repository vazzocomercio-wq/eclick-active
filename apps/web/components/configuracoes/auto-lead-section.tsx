'use client';

import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  pipelinesApi,
  type PipelineWithStages,
} from '@/lib/api/pipelines';
import {
  settingsApi,
  type AutoCreateDealSetting,
  type OrgSettings,
} from '@/lib/api/settings';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface AutoLeadSectionProps {
  org: OrgSettings | null;
  onSaved: () => void | Promise<void>;
}

/**
 * Configuração de "Leads Automáticos" — quando contato novo envia primeira
 * mensagem, cria deal automaticamente no pipeline+stage configurado. Salva
 * em `organizations.settings.auto_create_deal` via PATCH /settings/org.
 */
export function AutoLeadSection({ org, onSaved }: AutoLeadSectionProps) {
  const current = readSetting(org);

  const [enabled, setEnabled] = useState<boolean>(current.enabled);
  const [pipelineId, setPipelineId] = useState<string | null>(current.pipeline_id ?? null);
  const [stageId, setStageId] = useState<string | null>(current.stage_id ?? null);
  const [aiPosition, setAiPosition] = useState<boolean>(current.ai_position !== false);

  const [pipelines, setPipelines] = useState<PipelineWithStages[]>([]);
  const [loadingPipelines, setLoadingPipelines] = useState(true);
  const [saving, setSaving] = useState(false);

  // Resync quando o org muda (após reload)
  useEffect(() => {
    const next = readSetting(org);
    setEnabled(next.enabled);
    setPipelineId(next.pipeline_id ?? null);
    setStageId(next.stage_id ?? null);
    setAiPosition(next.ai_position !== false);
  }, [org]);

  // Carrega pipelines (ativos)
  useEffect(() => {
    setLoadingPipelines(true);
    pipelinesApi
      .list({ includeArchived: false })
      .then(setPipelines)
      .catch(() => setPipelines([]))
      .finally(() => setLoadingPipelines(false));
  }, []);

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId) ?? null;

  async function save() {
    setSaving(true);
    try {
      const payload: AutoCreateDealSetting = {
        enabled,
        pipeline_id: pipelineId,
        stage_id: stageId,
        ai_position: aiPosition,
      };
      await settingsApi.updateOrg({
        settings: { auto_create_deal: payload },
      });
      toast.success('Configuração salva');
      await onSaved();
    } catch (err) {
      toast.error('Falha ao salvar', {
        description:
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro desconhecido',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary" />
          Leads Automáticos
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ToggleRow
          label="Criar negócio automaticamente quando novo contato enviar mensagem"
          description="Toda primeira mensagem de um contato novo gera um deal no funil escolhido."
          value={enabled}
          onChange={setEnabled}
        />

        {enabled && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Pipeline alvo</Label>
              {loadingPipelines ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <select
                  value={pipelineId ?? ''}
                  onChange={(e) => {
                    setPipelineId(e.target.value || null);
                    setStageId(null); // reset stage quando pipeline muda
                  }}
                  className={cn(
                    'h-10 rounded-md border border-input bg-background px-3 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring',
                  )}
                >
                  <option value="">— Pipeline default da org —</option>
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.is_default ? ' (padrão)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedPipeline && (
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Stage padrão</Label>
                <select
                  value={stageId ?? ''}
                  onChange={(e) => setStageId(e.target.value || null)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— Primeiro stage não-fechado —</option>
                  {selectedPipeline.stages
                    .filter((s) => !s.is_won && !s.is_lost)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </div>
            )}

            <ToggleRow
              label="Permitir IA posicionar no stage"
              description="A IA pode promover leads quentes (intent='budget' + temperatura hot/very_hot) pra stages mais avançados que o default."
              value={aiPosition}
              onChange={setAiPosition}
            />
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving} size="sm">
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────

function readSetting(org: OrgSettings | null): AutoCreateDealSetting {
  const v = (org?.settings?.auto_create_deal ?? {}) as Partial<AutoCreateDealSetting>;
  return {
    enabled: v.enabled === true,
    pipeline_id: v.pipeline_id ?? null,
    stage_id: v.stage_id ?? null,
    ai_position: v.ai_position !== false,
  };
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary/30"
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-[11px] text-muted-foreground">{description}</span>
      </div>
      <span
        className={cn(
          'inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          value ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-full bg-background shadow transition-transform',
            value ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}
