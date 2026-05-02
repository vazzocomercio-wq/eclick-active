'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Brain,
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AiAgentPersona, AiTestConversation, AiTestMessage } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { aiPersonaApi } from '@/lib/api/ai-persona';
import { aiTestApi, type TestSourcesInput } from '@/lib/api/ai-test';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  { label: 'Pergunta de preço', text: 'Quanto custa?' },
  { label: 'Reclamação', text: 'Estou muito insatisfeito com o atendimento.' },
  { label: 'Agendamento', text: 'Vocês conseguem me atender amanhã?' },
  { label: 'Saudação', text: 'Olá, tudo bem?' },
  { label: 'Estoque (live)', text: 'Tem em estoque o produto X?' },
];

type SourceKey = 'use_kb' | 'use_skills' | 'use_live';

export function TestModeTab() {
  const [personas, setPersonas] = useState<AiAgentPersona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [session, setSession] = useState<AiTestConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sources, setSources] = useState<Required<TestSourcesInput>>({
    use_kb: true,
    use_skills: true,
    use_live: true,
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await aiPersonaApi.list();
        setPersonas(list);
        const def = list.find((p) => p.is_default && p.is_active) ?? list[0] ?? null;
        if (def) {
          setSelectedPersonaId(def.id);
          const s = await aiTestApi.createSession(def.id);
          setSession(s);
        }
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro',
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [session?.messages.length]);

  function toggleSource(key: SourceKey) {
    setSources((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function applyPreset(preset: 'persona_only' | 'kb_only' | 'kb_skills' | 'all') {
    setSources({
      use_kb: preset !== 'persona_only',
      use_skills: preset === 'kb_skills' || preset === 'all',
      use_live: preset === 'all',
    });
  }

  async function handleSend(text?: string) {
    const content = (text ?? draft).trim();
    if (!session || !content || sending) return;
    setSending(true);
    setDraft('');
    try {
      const result = await aiTestApi.sendMessage(session.id, content, sources);
      setSession(result.session);
    } catch (err) {
      toast.error('Falha ao enviar', {
        description:
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro',
      });
    } finally {
      setSending(false);
    }
  }

  async function handleClear() {
    if (!session) return;
    try {
      await aiTestApi.deleteSession(session.id);
      const s = await aiTestApi.createSession(selectedPersonaId ?? undefined);
      setSession(s);
      toast.success('Conversa limpa');
    } catch (err) {
      toast.error('Falha ao limpar', {
        description:
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro',
      });
    }
  }

  async function handleSwitchPersona(personaId: string) {
    setSelectedPersonaId(personaId);
    try {
      const s = await aiTestApi.createSession(personaId);
      setSession(s);
    } catch (err) {
      toast.error('Falha ao trocar persona', {
        description:
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro',
      });
    }
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (personas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
        <Sparkles className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">Nenhuma persona configurada</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Vá na aba "Persona" e crie uma persona primeiro.
        </p>
      </div>
    );
  }

  const persona = personas.find((p) => p.id === selectedPersonaId) ?? personas[0]!;

  return (
    <div className="flex h-[calc(100vh-220px)] flex-col gap-3 lg:flex-row lg:gap-4">
      {/* CHAT — coluna principal vertical, full height */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
          {session && session.messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
              <div>
                <Sparkles className="mx-auto mb-2 h-6 w-6 text-primary" />
                <p>Mande uma mensagem pra começar a testar</p>
                <p className="mt-1 text-[11px]">
                  A IA responde como <strong>{persona.name}</strong> usando a persona configurada.
                </p>
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {session?.messages.map((m, i) => (
                <li key={i}>
                  <MessageBubble message={m} personaName={persona.name} />
                </li>
              ))}
              {sending && (
                <li className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {persona.name} está digitando…
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 border-t border-border p-3">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Simule uma mensagem do cliente…"
            disabled={sending}
          />
          <Button onClick={() => void handleSend()} disabled={sending || !draft.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* SIDEBAR — todos os controles e configurações */}
      <aside className="flex shrink-0 flex-col gap-3 overflow-y-auto lg:w-96">
        {/* Persona + Limpar */}
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Testar com:</span>
            <select
              value={selectedPersonaId ?? ''}
              onChange={(e) => void handleSwitchPersona(e.target.value)}
              className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.is_default ? '(default)' : ''}
                </option>
              ))}
            </select>
          </div>
          <Button variant="outline" size="sm" onClick={handleClear}>
            <RefreshCw className="mr-1 h-3 w-3" /> Limpar conversa
          </Button>
        </div>

        {/* Toggles de fontes — calibração */}
        <SourcesPanel
          sources={sources}
          onToggle={toggleSource}
          onPreset={applyPreset}
        />

        {/* Sugestões */}
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
          <span className="text-xs font-medium">Sugestões rápidas</span>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => void handleSend(s.text)}
                disabled={sending}
                className="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-50"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Aviso modo teste */}
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-300">
          💡 Modo teste — nada do que aparece aqui afeta contatos, deals ou automações reais.
          Use os toggles acima pra isolar quais fontes calibram melhor a IA.
        </div>
      </aside>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Sources panel — controles de calibração
// ──────────────────────────────────────────────────────────

function SourcesPanel({
  sources,
  onToggle,
  onPreset,
}: {
  sources: Required<TestSourcesInput>;
  onToggle: (key: SourceKey) => void;
  onPreset: (preset: 'persona_only' | 'kb_only' | 'kb_skills' | 'all') => void;
}) {
  const [open, setOpen] = useState(true);
  const enabledCount = [sources.use_kb, sources.use_skills, sources.use_live].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs font-medium"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Fontes da IA (calibração)
        <span className="text-muted-foreground">
          — Persona sempre ON · {enabledCount}/3 fontes adicionais ligadas
        </span>
      </button>

      {open && (
        <>
          <div className="flex flex-col gap-2">
            <SourceToggle
              icon={BookOpen}
              label="Knowledge Base"
              description="Documentos manuais, URLs, arquivos uploadados"
              enabled={sources.use_kb}
              onToggle={() => onToggle('use_kb')}
            />
            <SourceToggle
              icon={Brain}
              label="Skills"
              description="Habilidades modulares com KB priorizado por intent"
              enabled={sources.use_skills}
              onToggle={() => onToggle('use_skills')}
            />
            <SourceToggle
              icon={Globe}
              label="Fontes Live"
              description="URLs consultadas em tempo real (estoque, preços)"
              enabled={sources.use_live}
              onToggle={() => onToggle('use_live')}
            />
          </div>

          <div className="flex flex-col gap-1.5 pt-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Presets:
            </span>
            <div className="flex flex-wrap gap-1.5">
              <PresetButton onClick={() => onPreset('persona_only')}>Só persona</PresetButton>
              <PresetButton onClick={() => onPreset('kb_only')}>Persona + KB</PresetButton>
              <PresetButton onClick={() => onPreset('kb_skills')}>+ Skills</PresetButton>
              <PresetButton onClick={() => onPreset('all')}>Tudo (produção)</PresetButton>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SourceToggle({
  icon: Icon,
  label,
  description,
  enabled,
  onToggle,
}: {
  icon: typeof BookOpen;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex flex-col gap-1 rounded-md border p-2 text-left transition-colors',
        enabled
          ? 'border-primary/40 bg-primary/5 hover:bg-primary/10'
          : 'border-border bg-background opacity-60 hover:opacity-100',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn('h-3.5 w-3.5', enabled ? 'text-primary' : 'text-muted-foreground')} />
        <span className="text-xs font-medium">{label}</span>
        <span
          className={cn(
            'ml-auto rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
            enabled ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
          )}
        >
          {enabled ? 'ON' : 'OFF'}
        </span>
      </div>
      <span className="text-[10px] text-muted-foreground">{description}</span>
    </button>
  );
}

function PresetButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
    >
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────────────────
// Traduções dos enums do classificador (backend retorna em inglês,
// UI em pt-BR)
// ──────────────────────────────────────────────────────────

const INTENT_LABEL: Record<string, string> = {
  budget: 'orçamento',
  question: 'dúvida',
  complaint: 'reclamação',
  negotiation: 'negociação',
  support: 'suporte',
  greeting: 'saudação',
  farewell: 'despedida',
  spam: 'spam',
  other: 'outro',
};

const SENTIMENT_LABEL: Record<string, string> = {
  very_positive: 'muito positivo',
  positive: 'positivo',
  neutral: 'neutro',
  negative: 'negativo',
  very_negative: 'muito negativo',
};

const TEMPERATURE_LABEL: Record<string, string> = {
  cold: 'frio',
  warm: 'morno',
  hot: 'quente',
  very_hot: 'muito quente',
};

function translateEnum(map: Record<string, string>, value: string): string {
  return map[value] ?? value;
}

// ──────────────────────────────────────────────────────────
// Message bubble + metadata
// ──────────────────────────────────────────────────────────

function MessageBubble({
  message,
  personaName,
}: {
  message: AiTestMessage;
  personaName: string;
}) {
  const isUser = message.role === 'user';
  const meta = message.ai_metadata;
  const liveSourcesCount = meta?.live_sources_used?.length ?? 0;

  return (
    <div className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {isUser ? 'Você (cliente)' : personaName}
      </span>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
      >
        {message.content}
      </div>

      {!isUser && meta && (
        <div className="flex max-w-[85%] flex-col gap-1 pt-1">
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            {meta.intent_detected && (
              <Pill label="Intenção" value={translateEnum(INTENT_LABEL, meta.intent_detected)} />
            )}
            {meta.sentiment && (
              <Pill label="Sentimento" value={translateEnum(SENTIMENT_LABEL, meta.sentiment)} />
            )}
            {meta.temperature && (
              <Pill label="Temperatura" value={translateEnum(TEMPERATURE_LABEL, meta.temperature)} />
            )}
            {meta.active_skill ? (
              <Pill label="Skill" value={meta.active_skill.name} variant="primary" icon={Brain} />
            ) : meta.sources_disabled?.includes('skills') ? (
              <Pill label="Skill" value="OFF" variant="muted" />
            ) : (
              <Pill label="Skill" value="nenhum" variant="muted" />
            )}
            <Pill
              label="KB"
              value={
                meta.sources_disabled?.includes('kb')
                  ? 'OFF'
                  : `${meta.knowledge_sources_used?.length ?? 0} doc(s)`
              }
              variant={
                meta.sources_disabled?.includes('kb')
                  ? 'muted'
                  : (meta.knowledge_sources_used?.length ?? 0) > 0
                    ? 'primary'
                    : 'default'
              }
              icon={BookOpen}
            />
            <Pill
              label="Live"
              value={
                meta.sources_disabled?.includes('live')
                  ? 'OFF'
                  : liveSourcesCount > 0
                    ? `${liveSourcesCount} fonte(s)`
                    : 'não usada'
              }
              variant={
                meta.sources_disabled?.includes('live') ? 'muted' : liveSourcesCount > 0 ? 'success' : 'default'
              }
              icon={Globe}
            />
            {(meta.actions_would_take?.length ?? 0) > 0 && (
              <Pill label="Ações" value={`${meta.actions_would_take?.length} sugerida(s)`} />
            )}
            {meta.latency_ms && <Pill label="Lat" value={`${meta.latency_ms}ms`} />}
          </div>

          {/* Lista expandida de fontes consultadas */}
          {(meta.knowledge_sources_used?.length ?? 0) > 0 && (
            <details className="text-[10px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                ▸ Documentos KB usados
              </summary>
              <ul className="mt-1 ml-3 flex flex-col gap-0.5 text-muted-foreground">
                {meta.knowledge_sources_used?.map((s) => (
                  <li key={s.id}>
                    • <span className="font-medium text-foreground">{s.title}</span> ({s.category})
                  </li>
                ))}
              </ul>
            </details>
          )}

          {liveSourcesCount > 0 && (
            <details className="text-[10px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                ▸ Fontes live consultadas
              </summary>
              <ul className="mt-1 ml-3 flex flex-col gap-0.5 text-muted-foreground">
                {meta.live_sources_used?.map((s) => (
                  <li key={s.id}>
                    • <span className="font-medium text-foreground">{s.name}</span> —{' '}
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {(meta.actions_would_take?.length ?? 0) > 0 && (
            <details className="text-[10px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                ▸ Ações que tomaria em produção
              </summary>
              <ul className="mt-1 ml-3 flex flex-col gap-0.5 text-muted-foreground">
                {meta.actions_would_take?.map((a, i) => (
                  <li key={i}>• {a}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Pill({
  label,
  value,
  variant = 'default',
  icon: Icon,
}: {
  label: string;
  value: string;
  variant?: 'default' | 'primary' | 'success' | 'muted';
  icon?: typeof BookOpen;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5',
        variant === 'primary' && 'bg-primary/10 text-primary',
        variant === 'success' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
        variant === 'muted' && 'bg-muted/30 text-muted-foreground opacity-60',
        variant === 'default' && 'bg-muted/50',
      )}
    >
      {Icon && <Icon className="h-2.5 w-2.5" />}
      <span className="font-semibold uppercase tracking-wider opacity-60">{label}:</span>
      <span>{value}</span>
    </span>
  );
}
