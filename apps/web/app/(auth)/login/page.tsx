'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations('auth');
  const next = params.get('next') ?? '/central-de-acao';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(translateAuthError(authError.message, t));
        setSubmitting(false);
        return;
      }

      // router.refresh() força o middleware a re-rodar com o cookie novo
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.unknown'));
      setSubmitting(false);
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
            <p className="text-sm text-muted-foreground">
              {t('login.tagline')}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">{t('login.emailLabel')}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.emailPlaceholder')}
                autoComplete="email"
                autoFocus
                required
                disabled={submitting}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t('login.passwordLabel')}</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {t('login.forgotPassword')}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitting ? t('login.submitting') : t('login.submit')}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            {t('login.restrictedNotice')}
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

/** Traduz mensagens comuns do Supabase Auth pro idioma do usuário. */
function translateAuthError(
  message: string,
  t: ReturnType<typeof useTranslations>,
): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return t('errors.invalidCredentials');
  }
  if (lower.includes('email not confirmed')) {
    return t('errors.emailNotConfirmed');
  }
  if (lower.includes('rate limit')) {
    return t('errors.rateLimit');
  }
  return message;
}
