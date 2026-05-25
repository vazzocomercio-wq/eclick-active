'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Palette,
  Loader2,
  Check,
  RotateCcw,
  Sparkles,
  Plus,
  X,
  Link2,
  Image as ImageIcon,
  Database,
  ChevronDown,
} from 'lucide-react';
import {
  socialApi,
  type PromptOverride,
  type PromptKind,
  type KnowledgeSource,
} from '@/lib/api/social';
import { VIDEO_STYLES, SCRIPT_FRAMEWORKS } from '@/lib/social/video-styles';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Tab = 'video_style' | 'framework' | 'system_prompt';

const SYSTEM_PROMPTS: Array<{ key: string; label: string; desc: string }> = [
  { key: 'POST_SYSTEM_PROMPT', label: 'Post (copy)', desc: 'instrução central pra gerar posts estáticos' },
  { key: 'CAROUSEL_SYSTEM_PROMPT', label: 'Carrossel', desc: 'instrução pra gerar carrosséis (slides)' },
  { key: 'REEL_SCRIPT_SYSTEM_PROMPT', label: 'Reel (roteiro + legenda)', desc: 'roteiro de vídeo + legenda do reel' },
  { key: 'CALENDAR_SYSTEM_PROMPT', label: 'Calendário editorial', desc: 'gera o calendário de conteúdo' },
];

export default function EstilosPage() {
  const [tab, setTab] = useState<Tab>('video_style');
  const [overrides, setOverrides] = useState<PromptOverride[]>([]);
  const [loading, setLoading] = useState(true);

  function reload() {
    return socialApi.prompts.list().then(setOverrides).catch(() => {});
  }
  useEffect(() => {
    socialApi.prompts.list().then(setOverrides).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const ovMap = useMemo(() => {
    const m = new Map<string, PromptOverride>();
    for (const o of overrides) m.set(`${o.kind}:${o.key}`, o);
    return m;
  }, [overrides]);

  const strong = VIDEO_STYLES.filter((s) => s.group === 'tipo' && s.tier === 'strong');
  const exp = VIDEO_STYLES.filter((s) => s.group === 'tipo' && s.tier === 'experimental');
  const ecom = VIDEO_STYLES.filter((s) => s.group === 'ecommerce');

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-border bg-background px-4 py-3 md:px-6">
        <Link href="/social" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Palette className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <h1 className="text-lg font-semibold leading-tight">Estúdio de Estilos</h1>
          <p className="text-xs text-muted-foreground">
            Edite os prompts dos estilos, frameworks e da IA. Vazio = usa o padrão do sistema.
          </p>
        </div>
      </header>

      <div className="border-b border-border bg-background px-4 md:px-6">
        <div className="flex gap-1">
          {([
            ['video_style', 'Estilos de vídeo'],
            ['framework', 'Frameworks de roteiro'],
            ['system_prompt', 'System prompts'],
          ] as Array<[Tab, string]>).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                'border-b-2 px-3 py-2 text-sm transition',
                tab === k
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-3">
            {tab === 'video_style' && (
              <>
                <GroupLabel>🟢 Fortes</GroupLabel>
                {strong.map((s) => (
                  <PromptRow key={s.id} kind="video_style" itemKey={s.id} defaultLabel={s.label} defaultPrompt={s.hint} defaultCamera={s.camera} override={ovMap.get(`video_style:${s.id}`)} onChanged={reload} />
                ))}
                <GroupLabel>🛒 E-commerce</GroupLabel>
                {ecom.map((s) => (
                  <PromptRow key={s.id} kind="video_style" itemKey={s.id} defaultLabel={s.label} defaultPrompt={s.hint} defaultCamera={s.camera} override={ovMap.get(`video_style:${s.id}`)} onChanged={reload} />
                ))}
                <GroupLabel>🟡 Experimentais</GroupLabel>
                {exp.map((s) => (
                  <PromptRow key={s.id} kind="video_style" itemKey={s.id} defaultLabel={s.label} defaultPrompt={s.hint} defaultCamera={s.camera} override={ovMap.get(`video_style:${s.id}`)} onChanged={reload} />
                ))}
              </>
            )}
            {tab === 'framework' &&
              SCRIPT_FRAMEWORKS.map((f) => (
                <PromptRow key={f.id} kind="framework" itemKey={f.id} defaultLabel={f.label} defaultPrompt={f.hint} override={ovMap.get(`framework:${f.id}`)} onChanged={reload} />
              ))}
            {tab === 'system_prompt' && (
              <>
                <p className="rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
                  Deixe vazio pra usar o prompt padrão do sistema. O que você escrever aqui substitui o padrão na geração.
                </p>
                {SYSTEM_PROMPTS.map((sp) => (
                  <PromptRow key={sp.key} kind="system_prompt" itemKey={sp.key} defaultLabel={sp.label} defaultDesc={sp.desc} defaultPrompt="" override={ovMap.get(`system_prompt:${sp.key}`)} onChanged={reload} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function PromptRow({
  kind,
  itemKey,
  defaultLabel,
  defaultPrompt,
  defaultDesc,
  defaultCamera,
  override,
  onChanged,
}: {
  kind: PromptKind;
  itemKey: string;
  defaultLabel: string;
  defaultPrompt: string;
  defaultDesc?: string;
  defaultCamera?: string;
  override?: PromptOverride;
  onChanged: () => Promise<void> | void;
}) {
  const [prompt, setPrompt] = useState(override?.prompt ?? defaultPrompt);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInstr, setAiInstr] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  const hasOverride = !!override;
  const dirty = prompt !== (override?.prompt ?? defaultPrompt);

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      await socialApi.prompts.upsert({
        kind,
        key: itemKey,
        label: defaultLabel,
        prompt,
        camera: defaultCamera ?? null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    try {
      await socialApi.prompts.reset(kind, itemKey);
      setPrompt(defaultPrompt);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function genAi() {
    if (!aiInstr.trim()) return;
    setAiBusy(true);
    try {
      const r = await socialApi.prompts.generate({
        kind,
        key: itemKey,
        label: defaultLabel,
        instruction: aiInstr,
        current_prompt: prompt || undefined,
      });
      if (r.prompt) setPrompt(r.prompt);
      setAiOpen(false);
      setAiInstr('');
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium">{defaultLabel}</span>
          {hasOverride && (
            <span className="ml-2 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
              editado
            </span>
          )}
          {defaultDesc && (
            <span className="ml-2 text-[11px] text-muted-foreground">{defaultDesc}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setAiOpen((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-[11px] text-primary hover:bg-primary/10"
        >
          <Sparkles className="h-3 w-3" /> Gerar com IA
        </button>
      </div>

      {aiOpen && (
        <div className="mb-2 flex gap-2">
          <input
            value={aiInstr}
            onChange={(e) => setAiInstr(e.target.value)}
            placeholder="descreva o que você quer (ex.: mais cinematográfico, foco no produto, ritmo rápido)"
            className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none"
          />
          <Button size="sm" onClick={genAi} disabled={aiBusy || !aiInstr.trim()}>
            {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Gerar'}
          </Button>
        </div>
      )}

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={kind === 'system_prompt' ? 6 : 3}
        placeholder={kind === 'system_prompt' ? 'vazio = usa o padrão do sistema' : defaultPrompt}
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-relaxed outline-none"
      />

      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy || !dirty}>
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : saved ? (
            <Check className="mr-1 h-3.5 w-3.5" />
          ) : null}
          {saved ? 'Salvo' : 'Salvar'}
        </Button>
        {hasOverride && (
          <Button variant="outline" size="sm" onClick={restore} disabled={busy}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Restaurar padrão
          </Button>
        )}
      </div>

      {kind !== 'system_prompt' && <KnowledgeBox scope={itemKey} />}
    </div>
  );
}

function KnowledgeBox({ scope }: { scope: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<KnowledgeSource[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [type, setType] = useState<'image' | 'url'>('image');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const d = await socialApi.knowledge.list(scope).catch(() => []);
    setItems(d);
    setLoaded(true);
  }
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) void load();
  }
  async function add() {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await socialApi.knowledge.add({ scope, source_type: type, value: value.trim() });
      setValue('');
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    await socialApi.knowledge.remove(id).catch(() => {});
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div className="mt-2 border-t border-border pt-2">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <Database className="h-3 w-3" />
        Base de conhecimento{loaded ? ` (${items.length})` : ''}
        <ChevronDown className={cn('h-3 w-3 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {!loaded ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              {items.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {items.map((it) =>
                    it.source_type === 'image' ? (
                      <span key={it.id} className="relative h-14 w-14 overflow-hidden rounded border border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={it.value} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => remove(it.id)}
                          className="absolute right-0 top-0 bg-black/60 p-0.5 text-white"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ) : (
                      <span
                        key={it.id}
                        className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px]"
                        title={it.value}
                      >
                        <Link2 className="h-3 w-3 shrink-0" />
                        <span className="truncate">{it.title || it.value}</span>
                        {it.metadata?.scrape_error ? (
                          <span className="shrink-0 text-amber-500" title="não consegui ler o texto">⚠</span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => remove(it.id)}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ),
                  )}
                </div>
              )}
              <div className="flex items-center gap-1">
                <div className="flex overflow-hidden rounded-md border border-border">
                  <button
                    type="button"
                    onClick={() => setType('image')}
                    className={cn('px-2 py-1 text-[11px]', type === 'image' ? 'bg-primary/15 text-primary' : 'text-muted-foreground')}
                  >
                    <ImageIcon className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setType('url')}
                    className={cn('px-2 py-1 text-[11px]', type === 'url' ? 'bg-primary/15 text-primary' : 'text-muted-foreground')}
                  >
                    <Link2 className="h-3 w-3" />
                  </button>
                </div>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={type === 'image' ? 'URL da imagem de referência' : 'URL de site/loja/produto'}
                  className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] outline-none"
                />
                <Button size="sm" onClick={add} disabled={busy || !value.trim()}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
