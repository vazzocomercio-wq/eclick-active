'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';

export default function AceitarConvitePage() {
  return (
    <Suspense fallback={null}>
      <AceitarConviteInner />
    </Suspense>
  );
}

type Phase = 'verifying' | 'set_password' | 'submitting' | 'done' | 'error';

function AceitarConviteInner() {
  const router = useRouter();
  const t = useTranslations('auth');
  const [phase, setPhase] = useState<Phase>('verifying');
  const [error, setError] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  // ── Fase 1: completar a sessão a partir do hash/query do link de convite
  useEffect(() => {
    void (async () => {
      const supabase = createClient();

      // Supabase coloca o token no hash fragment quando vem de invite/recovery:
      //   #access_token=...&refresh_token=...&type=invite
      // Também aceita query string em alguns flows: ?access_token=...
      const hash = typeof window !== 'undefined' ? window.location.hash : '';
      const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : '');
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const type = params.get('type');

      try {
        if (accessToken && refreshToken) {
          const { error: setErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (setErr) {
            setError(translateAuthError(setErr.message, t));
            setPhase('error');
            return;
          }
        }

        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userData.user) {
          setError(t('invite.errors.validationFailed'));
          setPhase('error');
          return;
        }

        const meta = userData.user.user_metadata as Record<string, unknown> | null;
        if (meta?.org_name && typeof meta.org_name === 'string') setOrgName(meta.org_name);
        if (meta?.display_name && typeof meta.display_name === 'string') {
          setDisplayName(meta.display_name);
        }

        // Limpa hash da URL pra não ficar exposto
        if (typeof window !== 'undefined' && window.location.hash) {
          window.history.replaceState(null, '', window.location.pathname);
        }

        // Se o tipo não era invite, mesmo assim seguimos (compatível com
        // recovery flow caso o user clique em link errado)
        if (type && type !== 'invite' && type !== 'recovery' && type !== 'signup') {
          // Tipo desconhecido — não bloqueia, só loga em console
          console.warn(`[aceitar-convite] tipo de token inesperado: ${type}`);
        }

        setPhase('set_password');
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.unexpected'));
        setPhase('error');
      }
    })();
  }, []);

  // ── Fase 2: setar senha (e display_name se vazio)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(t('invite.errors.passwordTooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('invite.errors.passwordMismatch'));
      return;
    }

    setPhase('submitting');
    try {
      const supabase = createClient();
      const updates: { password: string; data?: Record<string, unknown> } = {
        password,
      };
      if (displayName.trim()) {
        updates.data = { display_name: displayName.trim() };
      }
      const { error: upErr } = await supabase.auth.updateUser(updates);
      if (upErr) {
        setError(translateAuthError(upErr.message, t));
        setPhase('set_password');
        return;
      }
      setPhase('done');
      // Pausa curta pra feedback visual e redireciona
      setTimeout(() => {
        router.replace('/central-de-acao');
        router.refresh();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.unexpected'));
      setPhase('set_password');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md border-border shadow-2xl">
        <CardContent className="flex flex-col gap-6 p-8">
          {/* Logo */}
          <div className="flex flex-col items-center gap-2">
            <Image
              src="/logo-icon.svg"
              alt="e-Click Active"
              width={240}
              height={96}
              priority
              className="h-16 w-auto"
            />
            <p className="text-sm text-muted-foreground">{t('invite.subtitle')}</p>
          </div>

          {phase === 'verifying' && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('invite.verifying')}
            </div>
          )}

          {phase === 'error' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.replace('/login')}
              >
                {t('invite.goToLogin')}
              </Button>
            </div>
          )}

          {phase === 'done' && (
            <div className="flex flex-col items-center gap-2 text-sm">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <span>{t('invite.done')}</span>
            </div>
          )}

          {(phase === 'set_password' || phase === 'submitting') && (
            <>
              {orgName && (
                <p className="rounded-md bg-primary/5 px-3 py-2 text-center text-xs">
                  {t.rich('invite.orgBanner', {
                    org: orgName,
                    strong: (chunks) => (
                      <span className="font-semibold">{chunks}</span>
                    ),
                  })}
                </p>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="name">{t('invite.nameLabel')}</Label>
                  <Input
                    id="name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t('invite.namePlaceholder')}
                    autoComplete="name"
                    disabled={phase === 'submitting'}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="password">{t('invite.newPasswordLabel')}</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('invite.newPasswordPlaceholder')}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    disabled={phase === 'submitting'}
                    autoFocus
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirm">{t('invite.confirmPasswordLabel')}</Label>
                  <Input
                    id="confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={t('invite.confirmPasswordPlaceholder')}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    disabled={phase === 'submitting'}
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={phase === 'submitting'}>
                  {phase === 'submitting' && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {phase === 'submitting' ? t('invite.submitting') : t('invite.submit')}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function translateAuthError(
  message: string,
  t: ReturnType<typeof useTranslations>,
): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid') && lower.includes('token')) {
    return t('invite.errors.invalidToken');
  }
  if (lower.includes('password') && lower.includes('weak')) {
    return t('errors.weakPassword');
  }
  if (lower.includes('rate limit')) {
    return t('errors.rateLimit');
  }
  return message;
}
