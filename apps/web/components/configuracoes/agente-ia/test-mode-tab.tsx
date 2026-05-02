'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Send, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AiAgentPersona, AiTestConversation, AiTestMessage } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { aiPersonaApi } from '@/lib/api/ai-persona';
import { aiTestApi } from '@/lib/api/ai-test';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  { label: 'Pergunta de preço', text: 'Quanto custa?' },
  { label: 'Reclamação', text: 'Estou muito insatisfeito com o atendimento.' },
  { label: 'Agendamento', text: 'Vocês conseguem me atender amanhã?' },
  { label: 'Saudação', text: 'Olá, tudo bem?' },
];

export function TestModeTab() {
  const [personas, setPersonas] = useState<AiAgentPersona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [session, setSession] = useState<AiTestConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Carrega personas + cria sessão inicial
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

  // Auto-scroll quando chega msg nova
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [session?.messages.length]);

  async function handleSend(text?: string) {
    const content = (text ?? draft).trim();
    if (!session || !content || sending) return;
    setSending(true);
    setDraft('');
    try {
      const result = await aiTestApi.sendMessage(session.id, content);
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
    <div className="flex h-[calc(100vh-220px)] flex-col gap-3">
      {/* Header com select de persona + ações */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <span className="text-xs text-muted-foreground">Testar com:</span>
        <select
          value={selectedPersonaId ?? ''}
          onChange={(e) => void handleSwitchPersona(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} {p.is_default ? '(default)' : ''}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleClear}>
            <RefreshCw className="mr-1 h-3 w-3" /> Limpar conversa
          </Button>
        </div>
      </div>

      {/* Sugestões */}
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => void handleSend(s.text)}
            disabled={sending}
            className="rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-50"
          >
            Simular: {s.label}
          </button>
        ))}
      </div>

      {/* Chat */}
      <div className="flex flex-1 gap-3 overflow-hidden">
        <div className="flex flex-1 flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card">
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
      </div>

      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-300">
        💡 Modo teste — nada do que aparece aqui afeta contatos, deals ou automações reais.
        Use pra refinar a persona antes de ativar o auto-respond.
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  personaName,
}: {
  message: AiTestMessage;
  personaName: string;
}) {
  const isUser = message.role === 'user';
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

      {!isUser && message.ai_metadata && (
        <div className="flex flex-wrap gap-1.5 pt-1 text-[10px]">
          {message.ai_metadata.intent_detected && (
            <Pill label="Intenção" value={message.ai_metadata.intent_detected} />
          )}
          {message.ai_metadata.sentiment && (
            <Pill label="Sentimento" value={message.ai_metadata.sentiment} />
          )}
          {message.ai_metadata.temperature && (
            <Pill label="Temperatura" value={message.ai_metadata.temperature} />
          )}
          {(message.ai_metadata.knowledge_sources_used?.length ?? 0) > 0 && (
            <Pill
              label="KB"
              value={`${message.ai_metadata.knowledge_sources_used?.length} fonte(s)`}
            />
          )}
          {(message.ai_metadata.actions_would_take?.length ?? 0) > 0 && (
            <Pill
              label="Ações"
              value={`${message.ai_metadata.actions_would_take?.length} sugerida(s)`}
            />
          )}
          {message.ai_metadata.latency_ms && (
            <Pill label="Lat" value={`${message.ai_metadata.latency_ms}ms`} />
          )}
        </div>
      )}
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5">
      <span className="font-semibold uppercase tracking-wider opacity-60">{label}:</span>
      <span>{value}</span>
    </span>
  );
}
