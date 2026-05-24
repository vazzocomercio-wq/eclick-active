/**
 * Catálogo de estilos de Reel/vídeo curto pro Social AI Studio.
 *
 * 3 eixos que se combinam:
 *   - tipo:      o "estilo" do vídeo (UGC, 360°, Cinemagraph…)
 *   - ecommerce: estilos específicos de marketplace (Ficha, Ambientação…)
 *   - framework: a estrutura de roteiro (D+S+B, AIDA…) — molda a LEGENDA
 *
 * `tier`:
 *   - 'strong'       → o motor de IA (image-to-video a partir da foto) entrega bem hoje
 *   - 'experimental' → depende de pessoa/áudio/footage; a IA tenta mas a fidelidade varia
 *
 * `hint` é a direção que vai pro prompt (movimento de câmera / ritmo / estrutura).
 * Tudo aqui é dado do front — o backend só repassa label + hint pra IA.
 */

export type StyleGroup = 'tipo' | 'ecommerce';
export type StyleTier = 'strong' | 'experimental';

export interface VideoStyle {
  id: string;
  label: string;
  group: StyleGroup;
  tier: StyleTier;
  /** Direção visual (en) injetada no prompt do vídeo image-to-video. */
  hint: string;
  /** Câmera padrão sugerida pro motor (quando aplicável). */
  camera?:
    | 'dolly-in' | 'dolly-out' | 'pan-left' | 'pan-right'
    | 'tilt-up' | 'tilt-down' | 'orbit' | 'static';
}

export interface ScriptFramework {
  id: string;
  label: string;
  /** Como estruturar a legenda/roteiro. */
  hint: string;
}

export const VIDEO_STYLES: VideoStyle[] = [
  // ── 🟢 Fortes (produto em movimento, a partir da foto) ──────────────────
  { id: '360', label: '360° / Rotação', group: 'tipo', tier: 'strong', camera: 'orbit',
    hint: 'slow 360-degree orbit around the product, product perfectly centered and sharp, studio lighting, photorealistic' },
  { id: 'loop', label: 'Loop perfeito', group: 'tipo', tier: 'strong', camera: 'static',
    hint: 'seamless looping motion, a single subtle element moving (sparkle/light), product static and crisp, designed to loop perfectly' },
  { id: 'cinemagraph', label: 'Cinemagraph', group: 'tipo', tier: 'strong', camera: 'static',
    hint: 'cinemagraph: the product is still while one element shimmers/glows subtly, premium, elegant, minimal motion' },
  { id: 'pov', label: 'POV (1ª pessoa)', group: 'tipo', tier: 'strong', camera: 'dolly-in',
    hint: 'first-person POV approaching the product, immersive, smooth handheld feel, product as the hero' },
  { id: 'hook_payoff', label: 'Hook + Payoff', group: 'tipo', tier: 'strong', camera: 'dolly-in',
    hint: 'strong reveal: quick build-up then a satisfying hero shot of the product, punchy pacing for the first 3 seconds' },
  { id: 'antes_depois', label: 'Antes & Depois', group: 'tipo', tier: 'strong', camera: 'static',
    hint: 'before/after transformation feel, ambiance shifting (dark to lit) to showcase the product impact' },
  { id: 'stop_motion', label: 'Stop Motion', group: 'tipo', tier: 'strong', camera: 'static',
    hint: 'stop-motion animation aesthetic, playful frame-by-frame movement of the product' },
  { id: 'storytelling', label: 'Storytelling', group: 'tipo', tier: 'strong', camera: 'dolly-in',
    hint: 'cinematic narrative shot, gentle camera move that tells a beginning-middle-end around the product' },

  // ── 🟡 Experimentais (pessoa / áudio / footage) ─────────────────────────
  { id: 'ugc', label: 'UGC (criador)', group: 'tipo', tier: 'experimental',
    hint: 'authentic user-generated-content vibe, casual handheld, organic feel (may include a person)' },
  { id: 'unboxing', label: 'Unboxing', group: 'tipo', tier: 'experimental',
    hint: 'unboxing experience, hands opening packaging revealing the product' },
  { id: 'demo', label: 'Hands-on / Demo', group: 'tipo', tier: 'experimental',
    hint: 'real-use demonstration of the product in action' },
  { id: 'tutorial', label: 'Tutorial / How-to', group: 'tipo', tier: 'experimental',
    hint: 'step-by-step how-to using/assembling the product' },
  { id: 'review', label: 'Review', group: 'tipo', tier: 'experimental',
    hint: 'detailed review look, highlighting pros and details of the product' },
  { id: 'comparativo', label: 'Comparativo (VS)', group: 'tipo', tier: 'experimental',
    hint: 'side-by-side comparison, product A vs B or old vs new' },
  { id: 'asmr', label: 'ASMR', group: 'tipo', tier: 'experimental',
    hint: 'ASMR aesthetic, extreme close-ups and tactile textures of the product (audio added later)' },
  { id: 'grwm', label: 'GRWM', group: 'tipo', tier: 'experimental',
    hint: 'get-ready-with-me routine with the product integrated naturally' },
  { id: 'day_in_life', label: 'Day in the Life', group: 'tipo', tier: 'experimental',
    hint: 'a-day-in-the-life routine showing natural use of the product' },
  { id: 'listicle', label: 'Listicle (Top)', group: 'tipo', tier: 'experimental',
    hint: 'top-list format ("3 reasons to…"), dynamic cuts highlighting features' },
  { id: 'reaction', label: 'Reaction', group: 'tipo', tier: 'experimental',
    hint: 'genuine reaction to the product, expressive and energetic' },
  { id: 'bts', label: 'Bastidores (BTS)', group: 'tipo', tier: 'experimental',
    hint: 'behind-the-scenes of production/assembly/manufacturing' },
  { id: 'trend', label: 'Trend / Mashup', group: 'tipo', tier: 'experimental',
    hint: 'product inserted into a trending audio/meme format, fast and fun' },

  // ── E-commerce / marketplace ────────────────────────────────────────────
  { id: 'ficha', label: 'Vídeo de ficha (ML)', group: 'ecommerce', tier: 'strong', camera: 'orbit',
    hint: 'clean product-listing video: product rotating/showcased on neutral background, 30-60s feel, sharp and well-lit' },
  { id: 'ambientacao', label: 'Ambientação', group: 'ecommerce', tier: 'strong', camera: 'dolly-in',
    hint: 'product shown in its real-use context (e.g., lamp lighting a living room), lifestyle and cozy' },
  { id: 'tecnico', label: 'Técnico (specs)', group: 'ecommerce', tier: 'strong', camera: 'pan-right',
    hint: 'technical highlight of specs, dimensions and materials, clean callout-style camera moves' },
  { id: 'instalacao', label: 'Instalação', group: 'ecommerce', tier: 'experimental',
    hint: 'step-by-step installation/assembly to reduce buyer doubts and returns' },
];

export const SCRIPT_FRAMEWORKS: ScriptFramework[] = [
  { id: 'dsb', label: 'Dor + Solução + Benefício', hint: 'Estruture: a DOR do público → o produto como SOLUÇÃO → o BENEFÍCIO concreto. (referência preferida)' },
  { id: 'aida', label: 'AIDA', hint: 'Estruture: Atenção (hook) → Interesse → Desejo → Ação (CTA).' },
  { id: 'pas', label: 'PAS', hint: 'Estruture: Problema → Agitação (intensifica a dor) → Solução (o produto).' },
  { id: 'bab', label: 'Before-After-Bridge', hint: 'Estruture: Antes (situação ruim) → Depois (situação ideal) → Ponte (o produto leva lá).' },
  { id: '4u', label: "4 U's", hint: 'Faça a copy Útil, Urgente, Única e Ultraespecífica.' },
  { id: 'hso', label: 'Hook-Story-Offer', hint: 'Estruture: Hook forte → Story curta e relacionável → Offer (oferta/CTA).' },
];

/** Modelos de IA de vídeo. `ready` = configurado no SaaS (Kling). Veo/Sora
 *  precisam de chave (Gemini/OpenAI) — listados mas desabilitados por ora. */
export interface VideoModel {
  id: string;
  label: string;
  ready: boolean;
}
export const VIDEO_MODELS: VideoModel[] = [
  { id: 'kling-v2-5',        label: 'Kling 2.5 Turbo — mais barato (~US$0,35/5s)', ready: true },
  { id: 'kling-v2-6',        label: 'Kling 2.6 — com áudio (~US$0,70/5s) · recomendado', ready: true },
  { id: 'kling-v2-1',        label: 'Kling 2.1 (~US$0,49/5s)', ready: true },
  { id: 'kling-v1-6',        label: 'Kling 1.6 — controle de câmera (~US$0,49/5s)', ready: true },
  { id: 'kling-v2-1-master', label: 'Kling 2.1 Master — premium (~US$1,40/5s)', ready: true },
  { id: 'veo-3.1-fast-generate-preview', label: 'Google Veo 3.1 Fast (precisa configurar)', ready: false },
  { id: 'sora-2',            label: 'OpenAI Sora 2 (precisa configurar)', ready: false },
];

export function findStyle(id?: string | null): VideoStyle | undefined {
  return id ? VIDEO_STYLES.find((s) => s.id === id) : undefined;
}
export function findFramework(id?: string | null): ScriptFramework | undefined {
  return id ? SCRIPT_FRAMEWORKS.find((f) => f.id === id) : undefined;
}
