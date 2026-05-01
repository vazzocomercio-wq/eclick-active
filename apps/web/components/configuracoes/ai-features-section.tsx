'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2, Sparkles } from 'lucide-react';
import type { AIFeatureName } from '@eclick-active/shared';
import { settingsApi, type AiFeature } from '@/lib/api/settings';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface FeatureMeta {
  name: AIFeatureName;
  label: string;
  description: string;
  group: 'conversation' | 'intelligence';
}

const FEATURE_META: FeatureMeta[] = [
  {
    name: 'auto_classify',
    label: 'Classificação automática',
    description: 'Detecta intenção, sentimento e urgência de cada mensagem.',
    group: 'conversation',
  },
  {
    name: 'suggest_response',
    label: 'Sugestão de resposta',
    description: 'Gera respostas para o vendedor com base no contexto + base de conhecimento.',
    group: 'conversation',
  },
  {
    name: 'summarize',
    label: 'Resumo de conversas',
    description: 'Resume conversas longas em 2-3 frases pra contexto rápido.',
    group: 'conversation',
  },
  {
    name: 'sentiment',
    label: 'Análise de sentimento',
    description: 'Detecta tom emocional da conversa em tempo real.',
    group: 'conversation',
  },
  {
    name: 'lead_scoring',
    label: 'Lead scoring',
    description: 'Score 0-100 de cada lead com base em sinais de engajamento e fit.',
    group: 'intelligence',
  },
  {
    name: 'copilot',
    label: 'Copiloto comercial',
    description: 'Assistente de IA conversacional para vendedores e gestores.',
    group: 'intelligence',
  },
  {
    name: 'auto_respond',
    label: 'Resposta automática',
    description: 'Responde mensagens automaticamente quando confiança for alta.',
    group: 'intelligence',
  },
  {
    name: 'follow_up_agent',
    label: 'Agente de follow-up',
    description: 'Agente autônomo que cria tarefas de retomada para leads sem resposta.',
    group: 'intelligence',
  },
];

export function AiFeaturesSection() {
  const [features, setFeatures] = useState<AiFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<AIFeatureName | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const list = await settingsApi.getAi();
      setFeatures(list);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar features',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggle(feature: AiFeature, enabled: boolean) {
    setBusyName(feature.feature_name);
    // Otimista
    setFeatures((curr) =>
      curr.map((f) =>
        f.feature_name === feature.feature_name ? { ...f, enabled } : f,
      ),
    );
    try {
      await settingsApi.updateAi(feature.feature_name, { enabled });
    } catch (err) {
      // Reverte
      setFeatures((curr) =>
        curr.map((f) =>
          f.feature_name === feature.feature_name ? { ...f, enabled: !enabled } : f,
        ),
      );
      setError(err instanceof Error ? err.message : 'Erro ao atualizar feature');
    } finally {
      setBusyName(null);
    }
  }

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  }

  const featureMap = new Map(features.map((f) => [f.feature_name, f]));
  const conversationFeatures = FEATURE_META.filter((m) => m.group === 'conversation');
  const intelligenceFeatures = FEATURE_META.filter((m) => m.group === 'intelligence');

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Inteligência Artificial</h2>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <FeatureGroup title="Conversação" hint="Aplicado em mensagens recebidas/enviadas">
        {conversationFeatures.map((meta) => {
          const f = featureMap.get(meta.name);
          if (!f) return null;
          return (
            <FeatureRow
              key={meta.name}
              meta={meta}
              feature={f}
              busy={busyName === meta.name}
              onToggle={(enabled) => void toggle(f, enabled)}
            />
          );
        })}
      </FeatureGroup>

      <FeatureGroup title="Inteligência" hint="Aplicado em deals, contatos e workflows">
        {intelligenceFeatures.map((meta) => {
          const f = featureMap.get(meta.name);
          if (!f) return null;
          return (
            <FeatureRow
              key={meta.name}
              meta={meta}
              feature={f}
              busy={busyName === meta.name}
              onToggle={(enabled) => void toggle(f, enabled)}
            />
          );
        })}
      </FeatureGroup>
    </section>
  );
}

function FeatureGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <span className="text-[10px] text-muted-foreground">· {hint}</span>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function FeatureRow({
  meta,
  feature,
  busy,
  onToggle,
}: {
  meta: FeatureMeta;
  feature: AiFeature;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-background/50 p-3',
        !feature.enabled && 'opacity-60',
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Sparkles className="h-3.5 w-3.5" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{meta.label}</span>
        <span className="text-[11px] text-muted-foreground">{meta.description}</span>
        <span className="text-[10px] text-muted-foreground/80 font-mono">
          {feature.provider} · {feature.model}
        </span>
      </div>

      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          checked={feature.enabled}
          onChange={(e) => onToggle(e.target.checked)}
          disabled={busy}
          className="peer sr-only"
        />
        <div
          className={cn(
            'h-5 w-9 rounded-full bg-muted transition-colors',
            'peer-checked:bg-primary',
            busy && 'opacity-50',
          )}
        />
        <div
          className={cn(
            'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform',
            'peer-checked:translate-x-4',
          )}
        />
        {busy && (
          <Loader2 className="ml-2 h-3 w-3 animate-spin text-muted-foreground" />
        )}
      </label>
    </div>
  );
}
