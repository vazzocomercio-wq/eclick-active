'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import type {
  AiAgentPersona,
  AiPersonaResponseLength,
  AiPersonaRole,
  AiPersonaTone,
} from '@eclick-active/shared';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { aiPersonaApi, type CreatePersonaInput } from '@/lib/api/ai-persona';
import { cn } from '@/lib/utils';

const ROLES: Array<{ value: AiPersonaRole; label: string }> = [
  { value: 'sales_assistant', label: 'Assistente de vendas' },
  { value: 'support_agent', label: 'Agente de suporte' },
  { value: 'receptionist', label: 'Recepcionista' },
  { value: 'custom', label: 'Customizado' },
];

const TONES: Array<{
  value: AiPersonaTone;
  label: string;
  example: string;
}> = [
  { value: 'formal', label: 'Formal', example: '"O senhor gostaria de verificar nossa tabela de preços?"' },
  { value: 'semiformal', label: 'Semiformal', example: '"Você gostaria de ver os preços que temos disponíveis?"' },
  { value: 'casual', label: 'Casual', example: '"Quer dar uma olhada nos nossos preços?"' },
  { value: 'friendly', label: 'Amigável', example: '"Posso te mandar a tabela de preços agora! 😊"' },
];

const LENGTHS: Array<{ value: AiPersonaResponseLength; label: string; example: string }> = [
  { value: 'short', label: 'Curta', example: 'Máximo 2 frases. Direto.' },
  { value: 'medium', label: 'Média', example: '2 a 4 frases. Equilibrado.' },
  { value: 'detailed', label: 'Detalhada', example: '4 a 6 frases quando precisa.' },
];

const LANGUAGES = [
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'en', label: 'Inglês' },
  { value: 'es', label: 'Espanhol' },
];

export function PersonaTab() {
  const [personas, setPersonas] = useState<AiAgentPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState<CreatePersonaInput>({
    name: 'Lia',
    role: 'sales_assistant',
    tone: 'semiformal',
    response_length: 'medium',
    language: 'pt-BR',
    response_delay_seconds: 0,
    guidelines: [],
    forbidden_topics: [],
    is_default: true,
    is_active: true,
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  /** Carga inicial: pega lista + popula form com a persona default. */
  const initialLoad = async () => {
    setLoading(true);
    try {
      const list = await aiPersonaApi.list();
      setPersonas(list);
      const def = list.find((p) => p.is_default && p.is_active) ?? list[0] ?? null;
      if (def) {
        loadFromPersona(def);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro');
    } finally {
      setLoading(false);
    }
  };

  /** Re-fetch lista sem desmontar o form (pra atualizar chips/badges). */
  const reloadListOnly = async () => {
    try {
      const list = await aiPersonaApi.list();
      setPersonas(list);
    } catch {
      // best-effort — se falhar, a lista local fica desatualizada mas o form continua
    }
  };

  useEffect(() => {
    void initialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadFromPersona(p: AiAgentPersona) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      avatar_url: p.avatar_url ?? undefined,
      role: p.role,
      personality: p.personality ?? undefined,
      tone: p.tone,
      response_length: p.response_length,
      language: p.language,
      response_delay_seconds: p.response_delay_seconds,
      guidelines: p.guidelines,
      forbidden_topics: p.forbidden_topics,
      greeting_message: p.greeting_message ?? undefined,
      fallback_message: p.fallback_message ?? undefined,
      is_default: p.is_default,
      is_active: p.is_active,
      settings: p.settings,
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm({
      name: '',
      role: 'sales_assistant',
      tone: 'semiformal',
      response_length: 'medium',
      language: 'pt-BR',
      response_delay_seconds: 0,
      guidelines: [],
      forbidden_topics: [],
      is_default: personas.length === 0,
      is_active: true,
    });
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('Nome do agente é obrigatório');
      return;
    }
    setSaving(true);
    try {
      let saved: AiAgentPersona;
      if (editingId) {
        saved = await aiPersonaApi.update(editingId, form);
        toast.success('Persona atualizada');
      } else {
        saved = await aiPersonaApi.create(form);
        toast.success('Persona criada');
      }
      // Recarrega o form a partir da persona QUE ACABOU DE SER SALVA — não
      // a default. Isso garante que os campos voltem com os valores que o
      // backend retornou (e expõe imediatamente se algo não persistiu).
      loadFromPersona(saved);
      // Atualiza só a lista de chips em background — não desmonta o form.
      void reloadListOnly();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro';
      toast.error('Falha ao salvar', { description: msg });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Lista de personas */}
      {personas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {personas.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => loadFromPersona(p)}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors',
                editingId === p.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card hover:bg-muted',
              )}
            >
              <Sparkles className="h-3 w-3" />
              {p.name}
              {p.is_default && (
                <span className="rounded bg-primary/20 px-1 text-[9px] uppercase text-primary">
                  Default
                </span>
              )}
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={resetForm}>
            <Plus className="mr-1 h-3 w-3" /> Nova
          </Button>
        </div>
      )}

      {personas.length === 0 && (
        <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Configure seu agente de IA</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Defina nome, tom de voz, personalidade e diretrizes. A IA vai usar essa
            configuração ao sugerir respostas, no copiloto e no auto-respond fora do horário.
          </p>
        </div>
      )}

      {/* Form */}
      <div className="grid gap-4 rounded-xl border border-border bg-card p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Nome do agente" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex: Lia, Assistente Vazzo"
            />
          </Field>
          <Field label="Papel">
            <Select
              value={form.role ?? 'sales_assistant'}
              options={ROLES}
              onChange={(v) => setForm({ ...form, role: v as AiPersonaRole })}
            />
          </Field>
        </div>

        <Field label="Personalidade">
          <Textarea
            value={form.personality ?? ''}
            onChange={(e) => setForm({ ...form, personality: e.target.value })}
            placeholder="Ex: Profissional mas amigável, focado em conversão, empático com objeções."
            rows={3}
          />
        </Field>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Tom de voz">
            <div className="flex flex-col gap-1.5">
              {TONES.map((t) => (
                <label
                  key={t.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-md border p-2 transition-colors',
                    form.tone === t.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50',
                  )}
                >
                  <input
                    type="radio"
                    checked={form.tone === t.value}
                    onChange={() => setForm({ ...form, tone: t.value })}
                    className="mt-1"
                  />
                  <div className="flex flex-1 flex-col">
                    <span className="text-xs font-semibold">{t.label}</span>
                    <span className="text-[10px] italic text-muted-foreground">{t.example}</span>
                  </div>
                </label>
              ))}
            </div>
          </Field>

          <div className="flex flex-col gap-3">
            <Field label="Tamanho das respostas">
              <Select
                value={form.response_length ?? 'medium'}
                options={LENGTHS}
                onChange={(v) => setForm({ ...form, response_length: v as AiPersonaResponseLength })}
              />
              <span className="mt-1 text-[10px] italic text-muted-foreground">
                {LENGTHS.find((l) => l.value === form.response_length)?.example}
              </span>
            </Field>

            <Field label="Idioma">
              <Select
                value={form.language ?? 'pt-BR'}
                options={LANGUAGES}
                onChange={(v) => setForm({ ...form, language: v })}
              />
            </Field>

            <Field label={`Delay simulado de digitação: ${form.response_delay_seconds ?? 0}s`}>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={form.response_delay_seconds ?? 0}
                onChange={(e) =>
                  setForm({ ...form, response_delay_seconds: Number(e.target.value) })
                }
                className="w-full"
              />
              <span className="text-[10px] text-muted-foreground">
                Simula tempo de digitação humano (0 = imediato)
              </span>
            </Field>
          </div>
        </div>

        <ListEditor
          label="Diretrizes obrigatórias"
          placeholder="Ex: Nunca ofereça desconto sem aprovação"
          values={form.guidelines ?? []}
          onChange={(v) => setForm({ ...form, guidelines: v })}
        />

        <ListEditor
          label="Tópicos proibidos"
          placeholder="Ex: concorrentes, política interna de preços"
          values={form.forbidden_topics ?? []}
          onChange={(v) => setForm({ ...form, forbidden_topics: v })}
        />

        <Field label="Mensagem de saudação">
          <Textarea
            value={form.greeting_message ?? ''}
            onChange={(e) => setForm({ ...form, greeting_message: e.target.value })}
            placeholder="Ex: Olá! Sou a Lia, assistente da Vazzo. Como posso ajudar?"
            rows={2}
          />
        </Field>

        <Field label="Mensagem de fallback (quando não souber responder)">
          <Textarea
            value={form.fallback_message ?? ''}
            onChange={(e) => setForm({ ...form, fallback_message: e.target.value })}
            placeholder="Ex: Vou transferir para um especialista que pode te ajudar melhor."
            rows={2}
          />
        </Field>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.is_default ?? false}
              onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
            />
            <span>Persona padrão da org</span>
          </label>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {editingId ? 'Atualizar persona' : 'Criar persona'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(
        'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
        'focus:outline-none focus:ring-2 focus:ring-ring',
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ListEditor({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault();
              onChange([...values, draft.trim()]);
              setDraft('');
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (draft.trim()) {
              onChange([...values, draft.trim()]);
              setDraft('');
            }
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px]"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((_, j) => j !== i))}
              className="rounded p-0.5 hover:bg-background"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
