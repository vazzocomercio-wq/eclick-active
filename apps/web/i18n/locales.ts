/**
 * Configuração central de idiomas do Active.
 * O idioma é escolhido por cookie (sem prefixo de rota) — ver
 * `request.ts` e `locale-actions.ts`.
 */

export const locales = ['pt', 'en', 'zh'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'pt';

/** Nome do cookie que guarda o idioma escolhido pelo usuário. */
export const LOCALE_COOKIE = 'ECLICK_LOCALE';

/** Rótulo de cada idioma no seletor (sempre no próprio idioma). */
export const localeNames: Record<Locale, string> = {
  pt: 'Português',
  en: 'English',
  zh: '中文',
};

/** Emoji de bandeira por idioma. */
export const localeFlags: Record<Locale, string> = {
  pt: '🇧🇷',
  en: '🇺🇸',
  zh: '🇨🇳',
};

/** Valor do atributo `lang` do <html> por idioma. */
export const htmlLang: Record<Locale, string> = {
  pt: 'pt-BR',
  en: 'en',
  zh: 'zh-CN',
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}
