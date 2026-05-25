'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plug, Trash2, AlertTriangle, Instagram, Music2 } from 'lucide-react';
import { socialApi, type SocialChannelCredential, type PublishingChannel } from '@/lib/api/social';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const CHANNEL_LABEL: Record<PublishingChannel, string> = {
  instagram_business: 'Instagram Business',
  tiktok_business: 'TikTok Business',
  facebook_page: 'Facebook Page',
};

const CHANNEL_ICON: Record<PublishingChannel, typeof Instagram> = {
  instagram_business: Instagram,
  tiktok_business: Music2,
  facebook_page: Plug,
};

/**
 * Tela de credenciais de canais sociais. MVP usa input manual de
 * Long-lived Access Token (gerado via Meta Graph Explorer ou OAuth do
 * próprio Active quando configurado). Token vai criptografado AES-GCM
 * pra DB.
 */
export default function SocialCredentialsPage() {
  const [creds, setCreds] = useState<SocialChannelCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const refresh = async () => {
    try {
      const list = await socialApi.credentials.list();
      setCreds(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  // Feedback do retorno do OAuth do TikTok (?tiktok=success|error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tk = params.get('tiktok');
    if (!tk) return;
    if (tk === 'success') {
      const user = params.get('user');
      setBanner({
        kind: 'success',
        text: user ? `TikTok conectado: @${user}` : 'TikTok conectado com sucesso',
      });
    } else {
      setBanner({
        kind: 'error',
        text: `Falha ao conectar o TikTok: ${params.get('reason') ?? 'erro desconhecido'}`,
      });
    }
    // limpa a query da URL sem recarregar
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const connectTikTok = async () => {
    setConnecting(true);
    setBanner(null);
    try {
      const { url } = await socialApi.connect.tiktokAuthUrl();
      window.location.href = url;
    } catch (err) {
      setConnecting(false);
      setBanner({
        kind: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Não consegui iniciar a conexão. O app TikTok já foi configurado?',
      });
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/configuracoes">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Plug className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Conexões sociais</h1>
            <p className="text-xs text-muted-foreground">
              Conecte Instagram/TikTok pra publicação automática
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={connectTikTok}
            disabled={connecting}
          >
            <Music2 className="h-3.5 w-3.5" />
            <span className="ml-1">
              {connecting ? 'Abrindo TikTok…' : 'Conectar TikTok'}
            </span>
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plug className="h-3.5 w-3.5" />
            <span className="ml-1">Conectar canal</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {banner && (
          <div
            className={cn(
              'mb-4 rounded-lg border p-3 text-sm',
              banner.kind === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
            )}
          >
            {banner.text}
          </div>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : creds.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <Instagram className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhuma conexão configurada. Sem isso, publicações ficam apenas
              como exportação manual (ZIP).
            </p>
            <Button size="sm" className="mt-3" onClick={() => setShowForm(true)}>
              Conectar primeiro canal
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {creds.map((c) => {
              const Icon = CHANNEL_ICON[c.channel] ?? Plug;
              const expired =
                c.expires_at && new Date(c.expires_at) < new Date();
              return (
                <div
                  key={c.id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border bg-card p-4',
                    !c.is_active && 'opacity-60',
                    expired && 'border-amber-500/50',
                  )}
                >
                  <Icon className="h-6 w-6 shrink-0 text-primary" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        {CHANNEL_LABEL[c.channel]}
                      </span>
                      {!c.is_active && (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                          Inativo
                        </span>
                      )}
                      {expired && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          Expirou
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.external_username
                        ? `@${c.external_username}`
                        : c.external_account_id}
                    </p>
                    {c.last_error && (
                      <p className="mt-1 text-[10px] text-red-700 dark:text-red-300">
                        {c.last_error}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      if (!confirm('Remover esta conexão?')) return;
                      await socialApi.credentials.delete(c.id);
                      void refresh();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {showForm && (
          <ConnectChannelForm
            onClose={() => setShowForm(false)}
            onSaved={() => {
              setShowForm(false);
              void refresh();
            }}
          />
        )}

        <div className="mt-6 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs">
          <p className="mb-1 font-medium">Como obter um Long-lived Access Token (Meta):</p>
          <ol className="ml-5 list-decimal space-y-1 text-foreground/80">
            <li>Acesse Meta Graph Explorer</li>
            <li>Selecione o app, gere User Access Token com escopos: <code className="rounded bg-muted px-1">instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement</code></li>
            <li>Troque por Long-lived Token (60 dias) via <code className="rounded bg-muted px-1">/oauth/access_token?grant_type=fb_exchange_token</code></li>
            <li>Pegue o Instagram Business User ID via <code className="rounded bg-muted px-1">/me/accounts</code> → instagram_business_account.id</li>
            <li>Cole abaixo</li>
          </ol>
        </div>

        <div className="mt-3 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 p-3 text-xs">
          <p className="mb-1 font-medium">TikTok (rede social — postar reels):</p>
          <p className="text-foreground/80">
            Use o botão{' '}
            <span className="font-medium">&ldquo;Conectar TikTok&rdquo;</span> acima
            (OAuth). Requer um app no TikTok for Developers com Login Kit +
            Content Posting API e os scopes{' '}
            <code className="rounded bg-muted px-1">video.publish</code> +{' '}
            <code className="rounded bg-muted px-1">video.upload</code>. Enquanto o
            app não passa pela auditoria do TikTok, as publicações saem como
            privadas (SELF_ONLY).
          </p>
        </div>
      </div>
    </div>
  );
}

function ConnectChannelForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [channel, setChannel] = useState<PublishingChannel>('instagram_business');
  const [igUserId, setIgUserId] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!igUserId || !token) {
      setError('IDs e token obrigatórios');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await socialApi.credentials.save({
        channel,
        external_account_id: igUserId.trim(),
        external_username: username.trim() || undefined,
        access_token: token.trim(),
        // Long-lived token Meta dura 60 dias
        expires_at:
          channel === 'instagram_business'
            ? new Date(Date.now() + 60 * 86_400_000).toISOString()
            : undefined,
        scopes:
          channel === 'instagram_business'
            ? ['instagram_basic', 'instagram_content_publish']
            : [],
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">Conectar canal</h2>

        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Canal
          </span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as PublishingChannel)}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="instagram_business">Instagram Business</option>
            <option value="tiktok_business">TikTok Business (em breve)</option>
          </select>
        </label>

        <label className="mt-3 block">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Instagram Business User ID *
          </span>
          <input
            value={igUserId}
            onChange={(e) => setIgUserId(e.target.value)}
            placeholder="17841400000000000"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Username (opcional)
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="vazzo_oficial"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Long-lived Access Token *
          </span>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="EAAB..."
            rows={3}
            className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
          />
          <span className="text-[10px] text-muted-foreground">
            Token é criptografado AES-256-GCM antes de salvar
          </span>
        </label>

        {error && (
          <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? 'Salvando…' : 'Conectar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
