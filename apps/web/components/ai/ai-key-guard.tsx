'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, X, ArrowRight, Sparkles } from 'lucide-react';

/**
 * AiKeyGuard — guard global pra BYOK.
 *
 * O api client (lib/api/client.ts) dispara o evento `eclick:ai-key-required`
 * quando o backend responde 402 { error: 'ai_key_required', provider, message }
 * — ou seja, a org está em modo 'own' sem chave de IA configurada.
 *
 * Este componente escuta esse evento e abre um modal "Conecte sua chave de IA"
 * que leva pra /configuracoes (aba Chaves de IA). Montado 1x no layout do
 * dashboard — não precisa migrar call-sites.
 */

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  google: 'Google (Gemini)',
  IA: 'IA',
};

interface AiKeyInfo {
  provider: string;
  message: string;
}

export function AiKeyGuard() {
  const [info, setInfo] = useState<AiKeyInfo | null>(null);
  const router = useRouter();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { provider?: string; message?: string } | undefined;
      setInfo((curr) =>
        curr ?? {
          provider: detail?.provider ?? 'IA',
          message:
            detail?.message ?? 'Conecte sua chave de IA pra usar este recurso.',
        },
      );
    };
    window.addEventListener('eclick:ai-key-required', handler);
    return () => window.removeEventListener('eclick:ai-key-required', handler);
  }, []);

  if (!info) return null;

  const providerName = PROVIDER_LABEL[info.provider] ?? info.provider;

  function close() {
    setInfo(null);
  }

  function goConnect() {
    setInfo(null);
    router.push('/configuracoes');
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-primary/30 bg-card shadow-2xl"
      >
        <button
          type="button"
          onClick={close}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col gap-3 p-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" />
          </div>

          <h2 className="text-lg font-semibold">Conecte sua chave de IA</h2>

          <p className="text-sm text-muted-foreground">{info.message}</p>

          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span>
              Provedor necessário: <strong>{providerName}</strong>. Use sua própria
              chave pra consumir seus créditos.
            </span>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={goConnect}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Conectar chave <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              Agora não
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
