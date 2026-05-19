/**
 * Config de request do next-intl. Lê o idioma do cookie e carrega o
 * catálogo de mensagens correspondente.
 *
 * Fallback: o catálogo `pt` serve de base e o idioma alvo sobrescreve
 * por cima (deep-merge). Assim qualquer chave ainda não traduzida
 * aparece em português em vez de quebrar a tela.
 */
import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from './locales';

type Dict = { [k: string]: string | Dict };

function deepMerge(base: Dict, override: Dict): Dict {
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const b = out[k];
    if (v && typeof v === 'object' && b && typeof b === 'object') {
      out[k] = deepMerge(b as Dict, v as Dict);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const loaders: Record<Locale, () => Promise<{ default: Dict }>> = {
  pt: () => import('../messages/pt.json'),
  en: () => import('../messages/en.json'),
  zh: () => import('../messages/zh.json'),
};

async function loadMessages(locale: Locale): Promise<Dict> {
  const pt = (await loaders.pt()).default;
  if (locale === 'pt') return pt;
  const target = (await loaders[locale]()).default;
  return deepMerge(pt, target);
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale;
  return {
    locale,
    messages: await loadMessages(locale),
  };
});
