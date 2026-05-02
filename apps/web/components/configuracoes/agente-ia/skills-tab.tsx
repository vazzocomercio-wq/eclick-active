'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Brain,
  CalendarPlus,
  Heart,
  HelpCircle,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Star,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AiSkill } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { aiSkillsApi } from '@/lib/api/ai-skills';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const SKILL_ICON: Record<string, typeof Brain> = {
  qualificar_lead: Target,
  responder_duvidas: HelpCircle,
  agendar_reuniao: CalendarPlus,
  enviar_proposta: MessageSquare,
  follow_up: RefreshCw,
  resolver_reclamacao: Heart,
  coletar_feedback: Star,
  cross_sell: TrendingUp,
};

export function SkillsTab() {
  const [skills, setSkills] = useState<AiSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AiSkill | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const list = await aiSkillsApi.list();
      setSkills(list);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleSeed() {
    setSeeding(true);
    try {
      const r = await aiSkillsApi.seed();
      toast.success('Skills do sistema sincronizados', {
        description: `${r.created} criados, ${r.skipped} já existiam`,
      });
      await refresh();
    } catch (err) {
      toast.error('Falha ao sincronizar', {
        description: err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro',
      });
    } finally {
      setSeeding(false);
    }
  }

  async function handleToggleActive(skill: AiSkill) {
    try {
      await aiSkillsApi.update(skill.id, { is_active: !skill.is_active });
      await refresh();
    } catch (err) {
      toast.error('Falha ao atualizar', {
        description: err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro',
      });
    }
  }

  async function handleDeleteConfirmed() {
    if (!confirmDelete) return;
    try {
      await aiSkillsApi.remove(confirmDelete.id);
      toast.success('Skill removido');
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast.error('Falha ao remover', {
        description: err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro',
      });
      throw err;
    }
  }

  const systemSkills = useMemo(() => skills.filter((s) => s.skill_type === 'system'), [skills]);
  const customSkills = useMemo(() => skills.filter((s) => s.skill_type === 'custom'), [skills]);
  const activeCount = skills.filter((s) => s.is_active).length;

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando skills…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Skills de IA</h2>
          <p className="text-xs text-muted-foreground">
            {skills.length} skills · {activeCount} ativos
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSeed} disabled={seeding}>
            {seeding ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
            Sincronizar do sistema
          </Button>
        </div>
      </div>

      {systemSkills.length === 0 && (
        <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-6">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Skills do sistema não populados</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Clique em "Sincronizar do sistema" pra criar os 8 skills padrão (qualificar lead,
            responder dúvidas, agendar reunião, enviar proposta, follow-up, resolver reclamação,
            coletar feedback, cross-sell).
          </p>
        </div>
      )}

      {systemSkills.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Skills do sistema
          </h3>
          <div className="grid gap-2 md:grid-cols-2">
            {systemSkills.map((s) => (
              <SkillCard key={s.id} skill={s} onToggle={handleToggleActive} />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2">
        <h3 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Skills customizados
          <Button variant="ghost" size="sm" disabled>
            <Plus className="mr-1 h-3 w-3" /> Criar custom (em breve)
          </Button>
        </h3>
        {customSkills.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Nenhum skill customizado ainda. Skills custom permitem prompts e ações específicas
            do seu negócio (CRUD via API hoje, UI em breve).
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {customSkills.map((s) => (
              <SkillCard
                key={s.id}
                skill={s}
                onToggle={handleToggleActive}
                onDelete={() => setConfirmDelete(s)}
              />
            ))}
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          open={!!confirmDelete}
          onOpenChange={(o) => !o && setConfirmDelete(null)}
          title={`Remover skill "${confirmDelete.name}"?`}
          description="Essa ação não pode ser desfeita. Skills custom removidos não voltam (skills do sistema podem ser re-sincronizados)."
          confirmLabel="Remover"
          variant="destructive"
          icon={Trash2}
          onConfirm={handleDeleteConfirmed}
        />
      )}
    </div>
  );
}

function SkillCard({
  skill,
  onToggle,
  onDelete,
}: {
  skill: AiSkill;
  onToggle: (s: AiSkill) => void;
  onDelete?: () => void;
}) {
  const Icon = SKILL_ICON[skill.name] ?? Brain;
  const conditions = skill.trigger_conditions as {
    intents?: string[];
    temperatures?: string[];
    sentiments?: string[];
    custom_phrases?: string[];
  };

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3 transition-colors',
        skill.is_active ? 'border-primary/30' : 'border-border opacity-60',
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
            skill.is_active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{skill.name}</span>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider',
                skill.skill_type === 'system'
                  ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                  : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
              )}
            >
              {skill.skill_type}
            </span>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">{skill.description}</p>

          <div className="flex flex-wrap gap-1 pt-1">
            {(skill.allowed_actions ?? []).slice(0, 4).map((a) => (
              <span
                key={a}
                className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
              >
                {a}
              </span>
            ))}
            {(conditions?.intents ?? []).slice(0, 3).map((i) => (
              <span
                key={`int-${i}`}
                className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[9px] text-blue-700 dark:text-blue-300"
              >
                intent: {i}
              </span>
            ))}
            {(conditions?.custom_phrases ?? []).slice(0, 2).map((p) => (
              <span
                key={`ph-${p}`}
                className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-700 dark:text-amber-300"
              >
                "{p}"
              </span>
            ))}
          </div>

          {skill.execution_count > 0 && (
            <div className="pt-1 text-[10px] text-muted-foreground">
              {skill.execution_count} execuções · {Number(skill.avg_confidence).toFixed(1)}% conf.
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <input
            type="checkbox"
            checked={skill.is_active}
            onChange={() => onToggle(skill)}
            className="h-4 w-4"
          />
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Remover"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
