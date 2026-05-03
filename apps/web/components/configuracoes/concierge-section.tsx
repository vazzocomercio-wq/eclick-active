'use client';

import { useEffect, useState } from 'react';
import { Bot, Loader2, MessageSquareText, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  pipelinesApi,
  type PipelineWithStages,
} from '@/lib/api/pipelines';
import {
  settingsApi,
  type AiConciergeSetting,
  type OrgSettings,
} from '@/lib/api/settings';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ConciergeSectionProps {
  org: OrgSettings | null;
  onSaved: () => void | Promise<void>;
}

const DEFAULT_SETTING: AiConciergeSetting = {
  enabled: false,
  auto_reply: false,
  send_bridge_message: true,
  business_context: '',
};

function readSetting(org: OrgSettings | null): AiConciergeSetting {
  if (!org) return DEFAULT_SETTING;
  const raw = org.settings?.ai_concierge as Partial<AiConciergeSetting> | undefined;
  if (!raw) return DEFAULT_SETTING;
  return {
    enabled: raw.enabled === true,
    auto_reply: raw.auto_reply === true,
    send_bridge_message: raw.send_bridge_message !== false,
    business_context: typeof raw.business_context === 'string' ? raw.business_context : '',
  };
}

/**
 * Configura o AI Concierge — primeira camada de IA conversacional.
 *
 * - Toggle global (enabled / auto_reply / bridge)
 * - Textarea pra business_context (descreve o negócio pra IA)
 * - Editor inline de description pra cada pipeline + stage (a IA usa essas
 *   descrições pra decidir onde encaixar cada lead)
 */
export function ConciergeSection({ org, onSaved }: ConciergeSectionProps) {
  const current = readSetting(org);

  const [enabled, setEnabled] = useState(current.enabled);
  const [autoReply, setAutoReply] = useState(current.auto_reply);
  const [bridge, setBridge] = useState(current.send_bridge_message);
  const [businessContext, setBusinessContext] = useState(current.business_context);

  const [pipelines, setPipelines] = useState<PipelineWithStages[]>([]);
  const [loadingPipelines, setLoadingPipelines] = useState(true);
  const [savingSetting, setSavingSetting] = useState(false);

  // Drafts locais de descrições (pipeline_id ou stage_id → texto editado)
  const [pipelineDrafts, setPipelineDrafts] = useState<Record<string, string>>({});
  const [stageDrafts, setStageDrafts] = useState<Record<string, string>>({});
  const [savingDescId, setSavingDescId] = useState<string | null>(null);

  // Resync após reload do org
  useEffect(() => {
    const next = readSetting(org);
    setEnabled(next.enabled);
    setAutoReply(next.auto_reply);
    setBridge(next.send_bridge_message);
    setBusinessContext(next.business_context);
  }, [org]);

  async function loadPipelines() {
    setLoadingPipelines(true);
    try {
      const list = await pipelinesApi.list({ includeArchived: false });
      setPipelines(list);
      // Inicializa drafts com descrições vigentes
      const pDrafts: Record<string, string> = {};
      const sDrafts: Record<string, string> = {};
      for (const p of list) {
        pDrafts[p.id] = p.description ?? '';
        for (const s of p.stages) {
          sDrafts[s.id] = s.description ?? '';
        }
      }
      setPipelineDrafts(pDrafts);
      setStageDrafts(sDrafts);
    } catch {
      setPipelines([]);
    } finally {
      setLoadingPipelines(false);
    }
  }

  useEffect(() => {
    void loadPipelines();
  }, []);

  async function saveSetting() {
    setSavingSetting(true);
    try {
      const payload: AiConciergeSetting = {
        enabled,
        auto_reply: autoReply,
        send_bridge_message: bridge,
        business_context: businessContext.trim(),
      };
      await settingsApi.updateOrg({ settings: { ai_concierge: payload } });
      toast.success('Concierge salvo');
      await onSaved();
    } catch (err) {
      toast.error('Falha ao salvar', {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSavingSetting(false);
    }
  }

  async function savePipelineDescription(p: PipelineWithStages) {
    const draft = pipelineDrafts[p.id] ?? '';
    if (draft === (p.description ?? '')) return;
    setSavingDescId(`p:${p.id}`);
    try {
      await pipelinesApi.update(p.id, { description: draft });
      toast.success('Descrição salva');
      // Atualiza local
      setPipelines((prev) =>
        prev.map((row) => (row.id === p.id ? { ...row, description: draft } : row)),
      );
    } catch (err) {
      toast.error('Falha ao salvar', {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSavingDescId(null);
    }
  }

  async function saveStageDescription(p: PipelineWithStages, stageId: string) {
    const stage = p.stages.find((s) => s.id === stageId);
    if (!stage) return;
    const draft = stageDrafts[stageId] ?? '';
    if (draft === (stage.description ?? '')) return;
    setSavingDescId(`s:${stageId}`);
    try {
      await pipelinesApi.updateStage(p.id, stageId, { description: draft });
      toast.success('Descrição salva');
      setPipelines((prev) =>
        prev.map((row) =>
          row.id === p.id
            ? {
                ...row,
                stages: row.stages.map((s) =>
                  s.id === stageId ? { ...s, description: draft } : s,
                ),
              }
            : row,
        ),
      );
    } catch (err) {
      toast.error('Falha ao salvar', {
        description: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSavingDescId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Bloco 1 — Toggle + business context */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500/30 to-blue-500/30 text-cyan-300">
              <Bot className="h-4 w-4" />
            </span>
            <div className="flex-1">
              <CardTitle className="text-base">AI Concierge</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                A IA recebe a primeira mensagem do cliente, faz uma pergunta
                de sondagem e decide automaticamente em qual pipeline + stage
                encaixar o lead — usando a persona ativa, as descrições dos
                pipelines e o contexto do negócio abaixo.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <ToggleRow
            id="concierge-enabled"
            label="Ativar Concierge"
            description="Liga toda a feature. Se off, segue o fluxo padrão (só sugestão pro agente)."
            checked={enabled}
            onChange={setEnabled}
          />
          <ToggleRow
            id="concierge-autoreply"
            label="Resposta automática"
            description="A IA envia mensagens reais pelo canal. Se off, o concierge marca o estado mas não envia nada."
            checked={autoReply}
            onChange={setAutoReply}
            disabled={!enabled}
          />
          <ToggleRow
            id="concierge-bridge"
            label="Mensagem de transição"
            description='Envia algo como "Vou te conectar com nosso especialista de X" depois de rotear o lead.'
            checked={bridge}
            onChange={setBridge}
            disabled={!enabled || !autoReply}
          />

          <div className="space-y-1.5">
            <Label htmlFor="business-context" className="text-xs uppercase tracking-wider text-muted-foreground">
              Contexto do negócio
            </Label>
            <textarea
              id="business-context"
              value={businessContext}
              onChange={(e) => setBusinessContext(e.target.value)}
              placeholder="Ex: Somos uma corretora de seguros para PMEs em São Paulo. Atendemos seguros de vida em grupo, frota empresarial e responsabilidade civil. Ticket médio R$ 8mil-R$ 50mil/ano."
              rows={4}
              disabled={!enabled}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
            <p className="text-[11px] text-muted-foreground">
              Quanto mais específico, melhor a IA escolhe o pipeline. Inclua
              segmento, ticket médio, tipos de cliente, jornada típica.
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={saveSetting} disabled={savingSetting}>
              {savingSetting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Salvar configuração
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bloco 2 — Descrições de pipelines/stages */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 text-fuchsia-300">
              <Wand2 className="h-4 w-4" />
            </span>
            <div className="flex-1">
              <CardTitle className="text-base">
                Descrições para a IA escolher
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                A IA lê estas descrições pra decidir qual pipeline e qual
                stage cada lead deve entrar. Pipelines/stages sem descrição
                são escolhidos só pelo nome — descreva pra dar contexto.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {loadingPipelines && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {!loadingPipelines && pipelines.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nenhum pipeline ativo. Crie um em <code>Funis</code> antes.
            </div>
          )}
          {!loadingPipelines &&
            pipelines.map((p) => (
              <div key={p.id} className="space-y-3 rounded-md border border-border bg-background/40 p-4">
                <div className="flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4 text-cyan-400" />
                  <span className="text-sm font-semibold">{p.name}</span>
                  {p.is_default && (
                    <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium text-cyan-300">
                      DEFAULT
                    </span>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Descrição do pipeline
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={pipelineDrafts[p.id] ?? ''}
                      onChange={(e) =>
                        setPipelineDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                      }
                      placeholder="Ex: Vendas para PMEs com ticket médio. Ciclo curto, decisão rápida."
                      className="text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => savePipelineDescription(p)}
                      disabled={
                        savingDescId === `p:${p.id}` ||
                        (pipelineDrafts[p.id] ?? '') === (p.description ?? '')
                      }
                    >
                      {savingDescId === `p:${p.id}` && (
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      )}
                      Salvar
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 pl-3 border-l-2 border-border/60">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Stages (descreva quais leads encaixam em cada um)
                  </Label>
                  {p.stages
                    .filter((s) => !s.is_won && !s.is_lost)
                    .map((s) => (
                      <div key={s.id} className="flex items-start gap-2">
                        <span
                          className="mt-1.5 h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ background: s.color }}
                        />
                        <div className="flex-1 space-y-1">
                          <span className="text-xs font-medium">{s.name}</span>
                          <div className="flex gap-2">
                            <Input
                              value={stageDrafts[s.id] ?? ''}
                              onChange={(e) =>
                                setStageDrafts((prev) => ({
                                  ...prev,
                                  [s.id]: e.target.value,
                                }))
                              }
                              placeholder="Ex: Cliente curioso, ainda explorando opções"
                              className="text-xs h-8"
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => saveStageDescription(p, s.id)}
                              disabled={
                                savingDescId === `s:${s.id}` ||
                                (stageDrafts[s.id] ?? '') === (s.description ?? '')
                              }
                              className="h-8"
                            >
                              {savingDescId === `s:${s.id}` && (
                                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                              )}
                              Salvar
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}

interface ToggleRowProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

function ToggleRow({ id, label, description, checked, onChange, disabled }: ToggleRowProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 rounded-md border border-border/60 bg-background/30 p-3',
        disabled && 'opacity-50',
      )}
    >
      <div className="flex-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-1 h-4 w-4 cursor-pointer"
      />
    </div>
  );
}
