'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  SlidersHorizontal,
  Loader2,
  Check,
  Lock,
} from 'lucide-react';
import {
  socialApi,
  type SocialCampaignRecipe,
  type CampaignAutonomy,
} from '@/lib/api/social';
import {
  VIDEO_STYLES,
  SCRIPT_FRAMEWORKS,
  VIDEO_MODELS,
} from '@/lib/social/video-styles';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const AUTONOMY: Array<[CampaignAutonomy, string, string]> = [
  ['draft', 'Rascunho', 'Gera tudo e deixa parado — você monta/agenda manualmente.'],
  ['approval', 'Aprovação (1 clique)', 'Gera e agenda, mas nada vai ao ar sem você aprovar. Recomendado.'],
  ['full_auto', 'Piloto automático', 'Aprova e agenda sozinho, sem revisão. Máxima automação, maior risco.'],
];

export default function AutomacaoPage() {
  const [recipe, setRecipe] = useState<SocialCampaignRecipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // campos do form
  const [numReels, setNumReels] = useState(3);
  const [numCarousels, setNumCarousels] = useState(1);
  const [numPosts, setNumPosts] = useState(3);
  const [videoModel, setVideoModel] = useState('sora-2');
  const [duration, setDuration] = useState(8);
  const [cadence, setCadence] = useState(7);
  const [hour, setHour] = useState(18);
  const [autonomy, setAutonomy] = useState<CampaignAutonomy>('approval');
  const [maxCost, setMaxCost] = useState(10);
  const [styles, setStyles] = useState<string[]>([]);
  const [frameworks, setFrameworks] = useState<string[]>([]);
  const [useInfluencer, setUseInfluencer] = useState(false);
  const [influencerEngine, setInfluencerEngine] = useState<'scene' | 'avatar'>('scene');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarVoice, setAvatarVoice] = useState('pt-BR-FranciscaNeural');
  const [highMargin, setHighMargin] = useState(false);
  const [overstock, setOverstock] = useState(false);
  const [followRadar, setFollowRadar] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    socialApi.recipes
      .getDefault(ctrl.signal)
      .then((r) => {
        setRecipe(r);
        setNumReels(r.num_reels);
        setNumCarousels(r.num_carousels);
        setNumPosts(r.num_posts);
        setVideoModel(r.video_model);
        setDuration(r.video_duration_seconds);
        setCadence(r.cadence_days);
        setHour(r.preferred_hour);
        setAutonomy(r.autonomy_level);
        setMaxCost(r.max_cost_usd);
        setStyles(r.allowed_video_styles ?? []);
        setFrameworks(r.allowed_frameworks ?? []);
        setUseInfluencer(r.use_ai_influencer ?? false);
        setInfluencerEngine(r.metadata?.influencer_engine === 'avatar' ? 'avatar' : 'scene');
        setAvatarUrl(r.metadata?.influencer_avatar_url ?? '');
        setAvatarVoice(r.metadata?.influencer_voice ?? 'pt-BR-FranciscaNeural');
        setHighMargin(r.prioritize_high_margin ?? false);
        setOverstock(r.prioritize_overstock ?? false);
        setFollowRadar(r.follow_radar ?? false);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Erro ao carregar'))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function save() {
    if (!recipe) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await socialApi.recipes.update(recipe.id, {
        num_reels: numReels,
        num_carousels: numCarousels,
        num_posts: numPosts,
        video_model: videoModel,
        video_duration_seconds: duration,
        cadence_days: cadence,
        preferred_hour: hour,
        autonomy_level: autonomy,
        max_cost_usd: maxCost,
        allowed_video_styles: styles,
        allowed_frameworks: frameworks,
        use_ai_influencer: useInfluencer,
        prioritize_high_margin: highMargin,
        prioritize_overstock: overstock,
        follow_radar: followRadar,
        metadata: {
          ...(recipe.metadata ?? {}),
          influencer_engine: influencerEngine,
          influencer_avatar_url: avatarUrl.trim() || undefined,
          influencer_voice: avatarVoice,
        },
      });
      setRecipe(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  const strong = VIDEO_STYLES.filter((s) => s.group === 'tipo' && s.tier === 'strong');
  const experimental = VIDEO_STYLES.filter((s) => s.group === 'tipo' && s.tier === 'experimental');
  const ecommerce = VIDEO_STYLES.filter((s) => s.group === 'ecommerce');

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-border bg-background px-4 py-3 md:px-6">
        <Link href="/social" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <SlidersHorizontal className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <h1 className="text-lg font-semibold leading-tight">Automação de Campanha</h1>
          <p className="text-xs text-muted-foreground">
            A receita que o Autopilot usa pra gerar conteúdo de cada produto.
          </p>
        </div>
        <Button size="sm" onClick={save} disabled={saving || loading || !recipe}>
          {saving ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : saved ? (
            <Check className="mr-1 h-3.5 w-3.5" />
          ) : null}
          {saved ? 'Salvo' : 'Salvar receita'}
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="mx-auto grid max-w-3xl gap-6">
            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            {/* Quantidades */}
            <Section title="Quantidades por produto" desc="Quantas peças a IA gera de cada tipo.">
              <div className="grid grid-cols-3 gap-3">
                <Num label="Reels" value={numReels} onChange={setNumReels} max={10} />
                <Num label="Carrosséis" value={numCarousels} onChange={setNumCarousels} max={5} />
                <Num label="Posts" value={numPosts} onChange={setNumPosts} max={10} />
              </div>
            </Section>

            {/* Vídeo */}
            <Section title="Vídeo dos reels" desc="Modelo de IA e duração de cada reel.">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Modelo de IA</span>
                  <select
                    value={videoModel}
                    onChange={(e) => setVideoModel(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  >
                    {VIDEO_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Num label="Duração (s)" value={duration} onChange={setDuration} min={4} max={15} />
              </div>
            </Section>

            {/* Estilos de vídeo */}
            <Section title="Estilos de vídeo permitidos" desc="A IA alterna entre os estilos marcados ao gerar os reels.">
              <StyleGroup title="🟢 Fortes" items={strong} selected={styles} onToggle={(id) => setStyles(toggle(styles, id))} />
              <StyleGroup title="🛒 E-commerce" items={ecommerce} selected={styles} onToggle={(id) => setStyles(toggle(styles, id))} />
              <StyleGroup title="🟡 Experimentais" items={experimental} selected={styles} onToggle={(id) => setStyles(toggle(styles, id))} />
            </Section>

            {/* Frameworks de copy */}
            <Section title="Frameworks de roteiro/copy" desc="Estruturas que a IA usa pras legendas.">
              <div className="flex flex-wrap gap-2">
                {SCRIPT_FRAMEWORKS.map((f) => {
                  const on = frameworks.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFrameworks(toggle(frameworks, f.id))}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs transition',
                        on
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/40',
                      )}
                      title={f.hint}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* Agenda */}
            <Section title="Agenda" desc="Como espalhar as publicações ao longo do tempo.">
              <div className="grid grid-cols-2 gap-3">
                <Num label="Espalhar em (dias)" value={cadence} onChange={setCadence} min={1} max={60} />
                <Num label="Horário preferido (h)" value={hour} onChange={setHour} min={0} max={23} />
              </div>
            </Section>

            {/* Autonomia */}
            <Section title="Nível de autonomia" desc="O quanto a IA faz sozinha.">
              <div className="grid gap-2">
                {AUTONOMY.map(([val, label, desc]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setAutonomy(val)}
                    className={cn(
                      'flex items-start gap-2 rounded-lg border p-3 text-left transition',
                      autonomy === val
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                        autonomy === val ? 'border-primary bg-primary' : 'border-muted-foreground',
                      )}
                    >
                      {autonomy === val && <Check className="h-3 w-3 text-primary-foreground" />}
                    </span>
                    <span>
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">{desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </Section>

            {/* Custo */}
            <Section title="Teto de custo" desc="Limite de gasto de IA por campanha (USD). Acima disso, a campanha não inicia.">
              <Num label="Teto (US$)" value={maxCost} onChange={setMaxCost} min={1} max={200} step={1} />
            </Section>

            {/* Inteligência comercial (Fase 2) */}
            <Section
              title="Inteligência comercial"
              desc="A IA usa esses sinais pra escolher o que empurrar e como falar."
            >
              <div className="grid gap-2">
                <Toggle
                  label="Priorizar alta margem"
                  desc="empurra mais os produtos que dão mais lucro"
                  checked={highMargin}
                  onChange={setHighMargin}
                />
                <Toggle
                  label="Girar overstock"
                  desc="cria urgência nos produtos parados no estoque"
                  checked={overstock}
                  onChange={setOverstock}
                />
                <Toggle
                  label="Seguir o Radar"
                  desc="surfa a tendência dos produtos com demanda subindo"
                  checked={followRadar}
                  onChange={setFollowRadar}
                />
              </div>
            </Section>

            {/* Influenciador IA (Fase 3) */}
            <Section
              title="Influenciador IA"
              desc="Reels em estilo UGC com um criador apresentando o produto (gerado por Sora/Veo). A legenda recebe o selo 'Conteúdo criado com IA' automaticamente."
            >
              <Toggle
                label="Gerar reels com influenciador IA"
                desc="experimental — a fidelidade varia; revise antes de publicar"
                checked={useInfluencer}
                onChange={setUseInfluencer}
              />
              {useInfluencer && (
                <div className="mt-3 grid gap-3 rounded-lg border border-border p-3">
                  <div>
                    <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Motor do influenciador
                    </span>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <EngineOpt
                        label="Cena (Kling/Sora)"
                        desc="criador na cena animando a foto — mais barato"
                        active={influencerEngine === 'scene'}
                        onClick={() => setInfluencerEngine('scene')}
                      />
                      <EngineOpt
                        label="Avatar falante (D-ID)"
                        desc="um rosto fala sobre o produto — usa créditos D-ID"
                        active={influencerEngine === 'avatar'}
                        onClick={() => setInfluencerEngine('avatar')}
                      />
                    </div>
                  </div>
                  {influencerEngine === 'avatar' && (
                    <>
                      <label className="text-sm">
                        <span className="mb-1 block text-xs font-medium text-muted-foreground">
                          Foto do apresentador (URL https, rosto frontal — opcional)
                        </span>
                        <input
                          value={avatarUrl}
                          onChange={(e) => setAvatarUrl(e.target.value)}
                          placeholder="https://…  (vazio = apresentador padrão do D-ID)"
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-xs font-medium text-muted-foreground">
                          Voz
                        </span>
                        <select
                          value={avatarVoice}
                          onChange={(e) => setAvatarVoice(e.target.value)}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                        >
                          <option value="pt-BR-FranciscaNeural">Francisca (feminina, pt-BR)</option>
                          <option value="pt-BR-AntonioNeural">Antônio (masculina, pt-BR)</option>
                        </select>
                      </label>
                    </>
                  )}
                </div>
              )}
            </Section>

            {/* Roadmap */}
            <Section title="Em breve" desc="Próximos passos do roadmap.">
              <div className="grid gap-2 text-sm text-muted-foreground">
                <Soon label="Disparar automaticamente quando um produto novo é cadastrado" />
                <Soon label="Avatar branded dedicado (Creatify) — requer chave de API" />
                <Soon label="Live commerce (TikTok Shop / IG Live)" />
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {desc && <p className="mb-3 mt-0.5 text-xs text-muted-foreground">{desc}</p>}
      {children}
    </section>
  );
}

function Num({
  label,
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
      />
    </label>
  );
}

function StyleGroup({
  title,
  items,
  selected,
  onToggle,
}: {
  title: string;
  items: typeof VIDEO_STYLES;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map((s) => {
          const on = selected.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onToggle(s.id)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition',
                on
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40',
              )}
              title={s.hint}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Soon({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2">
      <Lock className="h-3.5 w-3.5 shrink-0 opacity-60" />
      <span className="text-xs">{label}</span>
    </div>
  );
}

function EngineOpt({
  label,
  desc,
  active,
  onClick,
}: {
  label: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border p-2.5 text-left transition',
        active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
      )}
    >
      <span className="block text-sm font-medium">{label}</span>
      <span className="block text-[11px] text-muted-foreground">{desc}</span>
    </button>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition',
        checked ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {desc && <span className="block text-xs text-muted-foreground">{desc}</span>}
      </span>
      <span
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}
