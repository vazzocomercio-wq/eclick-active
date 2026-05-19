'use server';

/**
 * Server action que grava o idioma escolhido num cookie de 1 ano.
 * Chamada pelo LanguageSwitcher.
 */
import { cookies } from 'next/headers';
import { isLocale, LOCALE_COOKIE } from './locales';

export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
}
