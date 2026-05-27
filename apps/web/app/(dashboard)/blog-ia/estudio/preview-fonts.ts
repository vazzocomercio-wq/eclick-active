/**
 * Fontes de PREVIEW do seletor (Estúdio do Blog). Self-hospedadas via
 * next/font (não dependem de CDN externo no dashboard → renderizam garantido).
 * Espelha o catálogo do site público (eclick-frontend/.../_fonts/registry.ts).
 * `preload: false` — só infla o CSS, o woff2 baixa quando aplicado.
 */
import localFont from 'next/font/local';
import {
  Space_Grotesk,
  Sora,
  Outfit,
  Manrope,
  Inter_Tight,
  Chivo,
  Archivo,
  Syne,
  Exo_2,
  Unbounded,
  Lexend,
} from 'next/font/google';

const clash = localFont({
  src: [
    { path: './_fonts/clash-display-400.woff2', weight: '400', style: 'normal' },
    { path: './_fonts/clash-display-500.woff2', weight: '500', style: 'normal' },
    { path: './_fonts/clash-display-600.woff2', weight: '600', style: 'normal' },
    { path: './_fonts/clash-display-700.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], display: 'swap', preload: false });
const sora = Sora({ subsets: ['latin'], display: 'swap', preload: false });
const outfit = Outfit({ subsets: ['latin'], display: 'swap', preload: false });
const manrope = Manrope({ subsets: ['latin'], display: 'swap', preload: false });
const interTight = Inter_Tight({ subsets: ['latin'], display: 'swap', preload: false });
const chivo = Chivo({ subsets: ['latin'], display: 'swap', preload: false });
const archivo = Archivo({ subsets: ['latin'], display: 'swap', preload: false });
const syne = Syne({ subsets: ['latin'], display: 'swap', preload: false });
const exo2 = Exo_2({ subsets: ['latin'], display: 'swap', preload: false });
const unbounded = Unbounded({ subsets: ['latin'], display: 'swap', preload: false });
const lexend = Lexend({ subsets: ['latin'], display: 'swap', preload: false });

/** slug (do catálogo do backend) → className next/font pra aplicar no preview. */
export const PREVIEW_FONT_CLASS: Record<string, string> = {
  clash: clash.className,
  'space-grotesk': spaceGrotesk.className,
  sora: sora.className,
  outfit: outfit.className,
  manrope: manrope.className,
  'inter-tight': interTight.className,
  chivo: chivo.className,
  archivo: archivo.className,
  syne: syne.className,
  exo2: exo2.className,
  unbounded: unbounded.className,
  lexend: lexend.className,
};
