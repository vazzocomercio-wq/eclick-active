/**
 * Specs e limites OFICIAIS do Meta por formato de anúncio (Facebook/Instagram).
 * Fonte: Meta Ads Guide + Business Help Center + spec sheets 2026.
 * Usado pelo AdComplianceService (validação pré-publicação) e pelos prompts
 * de geração (pra o criativo nascer dentro da régua e não tomar reprovação).
 *
 * Valores são RECOMENDADOS (delivery ótima) + HARD (recusa do Meta).
 */

export type AdCreativeFormat = 'image' | 'carousel' | 'video' | 'reels';

/** Limites de texto (em caracteres). recommended = trunca/penaliza; hard = recusa. */
export const TEXT_LIMITS = {
  primary_text: { recommended: 125, hard: 2200 },
  headline: { recommended: 27, hard: 40 },
  description: { recommended: 30, hard: 30 },
} as const;

export interface FormatSpec {
  /** Proporções aceitas (largura/altura). */
  aspect: { min: number; max: number; recommended: number[] };
  /** Resoluções recomendadas (w×h). */
  resolutions: Array<{ w: number; h: number }>;
  imageTypes: string[];
  videoTypes: string[];
  maxImageBytes: number;
  maxVideoBytes: number;
  minWidth: number;
  minHeight: number;
  /** Tolerância de proporção (fração). */
  aspectTolerance: number;
  /** Carrossel: nº de cards. */
  cards?: { min: number; max: number };
  /** Vídeo/Reels: duração em segundos. */
  duration?: { recommendedMax: number; hardMax: number };
  /** Reels/Stories: safe zone (fração da altura/largura ocupada por UI). */
  safeZone?: { top: number; bottom: number; side: number };
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const AD_SPECS: Record<AdCreativeFormat, FormatSpec> = {
  image: {
    aspect: { min: 1.91 / 1, max: 4 / 5, recommended: [1, 4 / 5] },
    resolutions: [
      { w: 1440, h: 1440 },
      { w: 1440, h: 1800 },
    ],
    imageTypes: ['image/jpeg', 'image/png'],
    videoTypes: [],
    maxImageBytes: 30 * MB,
    maxVideoBytes: 0,
    minWidth: 600,
    minHeight: 600,
    aspectTolerance: 0.03,
  },
  carousel: {
    // Todos os cards DEVEM ter a mesma proporção (1:1 recomendado).
    aspect: { min: 4 / 5, max: 1, recommended: [1] },
    resolutions: [{ w: 1080, h: 1080 }],
    imageTypes: ['image/jpeg', 'image/png'],
    videoTypes: ['video/mp4', 'video/quicktime'],
    maxImageBytes: 30 * MB,
    maxVideoBytes: 4 * GB,
    minWidth: 600,
    minHeight: 600,
    aspectTolerance: 0.03,
    cards: { min: 2, max: 10 },
  },
  video: {
    aspect: { min: 4 / 5, max: 1, recommended: [4 / 5, 1] },
    resolutions: [{ w: 1080, h: 1350 }],
    imageTypes: [],
    videoTypes: ['video/mp4', 'video/quicktime'],
    maxImageBytes: 0,
    maxVideoBytes: 4 * GB,
    minWidth: 600,
    minHeight: 600,
    aspectTolerance: 0.03,
    duration: { recommendedMax: 60, hardMax: 241 * 60 },
  },
  reels: {
    aspect: { min: 9 / 16, max: 9 / 16, recommended: [9 / 16] },
    resolutions: [{ w: 1080, h: 1920 }],
    imageTypes: [],
    videoTypes: ['video/mp4', 'video/quicktime'],
    maxImageBytes: 0,
    maxVideoBytes: 4 * GB,
    minWidth: 500,
    minHeight: 888,
    aspectTolerance: 0.01,
    duration: { recommendedMax: 30, hardMax: 90 },
    safeZone: { top: 0.14, bottom: 0.35, side: 0.06 },
  },
};

/**
 * Padrões de política que MAIS reprovam (PT + EN). A causa #1 é "atributos
 * pessoais": o anúncio insinuar que conhece características do usuário.
 * Foco deve ser no benefício do produto, não em "você é/está X".
 * Heurística determinística — complementada por revisão de IA opcional.
 */
export const POLICY_PATTERNS: Array<{ id: string; severity: 'hard' | 'soft'; re: RegExp; hint: string }> = [
  {
    id: 'personal_attribute_2p',
    severity: 'hard',
    // "você está/é/anda + atributo sensível"
    re: /\b(voc[eê]|vc|tu|teu|sua|seu)\b[^.?!]{0,40}\b(acima do peso|gordo|gorda|obeso|obesa|magro demais|endividad|falid|desempregad|deprimid|ansios|solteir|divorciad|gay|l[eé]sbica|hiv|diab[eé]t|c[aâ]ncer|doente|gr[aá]vid|careca|velho|velha|idos[ao])\b/i,
    hint: 'Insinua atributo pessoal do usuário (saúde/finanças/relacionamento/idade). Reescreva focando no BENEFÍCIO do produto, não em "você é/está X".',
  },
  {
    id: 'personal_attribute_question',
    severity: 'hard',
    re: /(est[aá]|anda|se sente|cansad[ao] de (estar|ser))\s+(acima do peso|gordo|gorda|endividad|sozinh|deprimid|ansios)[^?]*\?/i,
    hint: 'Pergunta que assume condição pessoal do usuário — reprovação por atributos pessoais.',
  },
  {
    id: 'miracle_claim',
    severity: 'soft',
    re: /\b(cura|100%\s*garantid|resultado garantid|milagr|emagre[çc]a \d+\s*kg|sem esfor[çc]o|definitiv(o|amente))\b/i,
    hint: 'Promessa/garantia exagerada — risco de reprovação por alegação enganosa.',
  },
  {
    id: 'before_after_body',
    severity: 'soft',
    re: /\b(antes e depois|antes\/depois|before\s*&?\s*after)\b/i,
    hint: 'Antes/depois (sobretudo corporal) é restrito pelo Meta.',
  },
  {
    id: 'shouting',
    severity: 'soft',
    re: /([A-ZÁÉÍÓÚÂÊÔÃÕÇ]{6,}\s+){3,}|!{3,}/,
    hint: 'Excesso de CAPS-LOCK/pontuação — sinal de baixa qualidade, reduz entrega.',
  },
];
