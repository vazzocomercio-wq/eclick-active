'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck, ExternalLink, AlertTriangle } from 'lucide-react';
import {
  settingsApi,
  type LlmCredentials,
  type LlmProviderName,
  type UpdateLlmCredentialsInput,
} from '@/lib/api/settings';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const PROVIDER_LABEL: Record<LlmProviderName, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  google: 'Google (Gemini)',
};

const PROVIDER_HELP: Record<LlmProviderName, { url: string; label: string }> = {
  anthropic: { url: 'https://console.anthropic.com/settings/keys', label: 'console.anthropic.com' },
  openai: { url: 'https://platform.openai.com/api-keys', label: 'platform.openai.com' },
  google: { url: 'https://aistudio.google.com/apikey', label: 'aistudio.google.com' },
};

/**
 * Seção de credenciais de IA por org (BYOK).
 *
 * - Provider/modelo/chave de chat (org_llm_credentials).
 * - Chave OpenAI dedicada (Whisper/embeddings/DALL·E) — só quando o provider
 *   de chat não é OpenAI.
 * - Toggle ai_keys_mode: 'own' (usa minhas chaves, bloqueia IA sem chave) vs
 *   'platform' (usa a chave do servidor).
 */
export function LlmCredentialsSection() {
  const [cred, setCred] = useState<LlmCredentials | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Form state
  const [provider, setProvider] = useState<LlmProviderName>('anthropic');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [mode, setMode] = useState<'platform' | 'own'>('platform');

  const reload = useCallback(async () => {
    setError(null);
    try {
      const data = await settingsApi.getLlm();
      setCred(data);
      setProvider(data.provider);
      setModel(data.model);
      setMode(data.ai_keys_mode);
      setApiKey('');
      setOpenaiKey('');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar credenciais de IA',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const providerChanged = cred ? provider !== cred.provider : true;

  async function save() {
    setError(null);
    setOk(false);

    // Validações de UX (o backend revalida).
    if (mode === 'own' && !cred?.configured && !apiKey) {
      setError('Pra usar suas próprias chaves, configure a chave do provider de chat primeiro.');
      return;
    }
    if (providerChanged && !apiKey && (cred?.configured || mode === 'own')) {
      setError('Ao trocar de provider você precisa enviar a nova chave de API.');
      return;
    }

    const input: UpdateLlmCredentialsInput = {
      provider,
      model,
      ai_keys_mode: mode,
    };
    if (apiKey.trim()) input.api_key = apiKey.trim();
    if (openaiKey.trim()) input.openai_api_key = openaiKey.trim();

    setSaving(true);
    try {
      const updated = await settingsApi.updateLlm(input);
      setCred(updated);
      setProvider(updated.provider);
      setModel(updated.model);
      setMode(updated.ai_keys_mode);
      setApiKey('');
      setOpenaiKey('');
      setOk(true);
      setTimeout(() => setOk(false), 3000);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erro ao salvar credenciais de IA',
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="h-80 animate-pulse rounded-xl bg-muted" />;
  }

  const models = cred?.available_models?.[provider] ?? [];
  const help = PROVIDER_HELP[provider];

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Chaves de IA (BYOK)</h2>
      </div>

      <p className="text-xs text-muted-foreground">
        Conecte suas próprias chaves de IA pra usar os seus créditos. A chave fica
        criptografada e nunca é exibida por completo.
      </p>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {ok && (
        <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">
          Credenciais salvas ✓
        </div>
      )}

      {/* Modo BYOK */}
      <div className="flex items-start gap-3 rounded-lg border border-border bg-background/50 p-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ShieldCheck className="h-3.5 w-3.5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">Usar minhas próprias chaves</span>
          <span className="text-[11px] text-muted-foreground">
            Quando ligado, a IA usa só as chaves desta org (seus créditos). Sem chave
            configurada, os recursos de IA ficam bloqueados.
          </span>
        </div>
        <label className="relative inline-flex shrink-0 cursor-pointer items-center">
          <input
            type="checkbox"
            checked={mode === 'own'}
            onChange={(e) => setMode(e.target.checked ? 'own' : 'platform')}
            className="peer sr-only"
          />
          <div className="h-5 w-9 rounded-full bg-muted transition-colors peer-checked:bg-primary" />
          <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform peer-checked:translate-x-4" />
        </label>
      </div>

      {mode === 'own' && !cred?.configured && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            Modo próprio ativado mas sem chave configurada — a IA fica bloqueada até
            você salvar uma chave de chat abaixo.
          </span>
        </div>
      )}

      {/* Provider + modelo */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Provedor de chat</label>
          <select
            value={provider}
            onChange={(e) => {
              const p = e.target.value as LlmProviderName;
              setProvider(p);
              const list = cred?.available_models?.[p] ?? [];
              setModel(list[0] ?? '');
            }}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {(cred?.available_providers ?? ['anthropic', 'openai', 'google']).map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">Modelo</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Chave de chat */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium">
          Chave {PROVIDER_LABEL[provider]}
          {cred?.api_key_last4 && !providerChanged && (
            <span className="ml-2 font-mono text-[10px] text-muted-foreground">
              configurada ····{cred.api_key_last4}
            </span>
          )}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            cred?.api_key_last4 && !providerChanged
              ? 'Deixe em branco pra manter a atual'
              : 'Cole sua chave de API'
          }
          autoComplete="off"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
        />
        <a
          href={help.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          Pegar chave em {help.label} <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Chave OpenAI dedicada — só quando provider de chat não é openai */}
      {provider !== 'openai' && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background/50 p-3">
          <label className="text-xs font-medium">
            Chave OpenAI dedicada
            {cred?.openai_api_key_last4 && (
              <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                configurada ····{cred.openai_api_key_last4}
              </span>
            )}
          </label>
          <span className="text-[11px] text-muted-foreground">
            Necessária pra transcrição de áudio, busca semântica e geração de imagens
            (recursos OpenAI-only). Opcional se você usa OpenAI como provedor de chat.
          </span>
          <input
            type="password"
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            placeholder={
              cred?.openai_api_key_last4
                ? 'Deixe em branco pra manter a atual'
                : 'sk-... (opcional)'
            }
            autoComplete="off"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
          />
          <a
            href={PROVIDER_HELP.openai.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Pegar chave em {PROVIDER_HELP.openai.label} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className={cn(
            'inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity',
            saving && 'opacity-60',
          )}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Salvar credenciais
        </button>
      </div>
    </section>
  );
}
