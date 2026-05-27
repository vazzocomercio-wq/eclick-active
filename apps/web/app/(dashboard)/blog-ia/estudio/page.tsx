'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Loader2,
  Sparkles,
  Save,
  RotateCcw,
  ArrowLeft,
  BookOpen,
  Link2,
  FileText,
  Trash2,
  Check,
  AlertCircle,
  Wand2,
  Type,
} from 'lucide-react';
import {
  blogAiApi,
  type BlogPrompt,
  type BlogPromptKey,
  type BlogKnowledgeSource,
  type BlogFontOption,
} from '@/lib/api/blog-ai';
/** Stylesheets de preview (Google Fonts todas as famílias + Fontshare p/ Clash). */
function previewFontHref(fonts: BlogFontOption[]): string | null {
  const params = fonts.map((f) => f.google).filter((g): g is string => !!g);
  if (!params.length) return null;
  return `https://fonts.googleapis.com/css2?${params.map((p) => `family=${p}`).join('&')}&display=swap`;
}
const CLASH_PREVIEW_HREF = 'https://api.fontshare.com/v2/css?f[]=clash-display@400,500,600,700&display=swap';
import { ApiError } from '@/lib/api/client';

export default function BlogStudioPage() {
  const t = useTranslations('blogIa');

  const [prompts, setPrompts] = useState<BlogPrompt[]>([]);
  const [knowledge, setKnowledge] = useState<BlogKnowledgeSource[]>([]);
  const [fonts, setFonts] = useState<BlogFontOption[]>([]);
  const [currentFont, setCurrentFont] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([blogAiApi.listPrompts(), blogAiApi.listKnowledge(), blogAiApi.listFonts(), blogAiApi.getSettings()])
      .then(([p, k, f, s]) => {
        setPrompts(p);
        setKnowledge(k);
        setFonts(f);
        setCurrentFont(s.display_font);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
     <div className="flex-1 overflow-y-auto">
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Link href="/blog-ia" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {t('studio.back')}
      </Link>
      <div className="mb-6">
        <div className="flex items-center gap-2 text-primary">
          <Wand2 className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-wider">{t('studio.tag')}</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-foreground">{t('studio.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('studio.subtitle')}</p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> …
        </div>
      ) : (
        <>
          {/* Fonte do blog */}
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t('studio.fontTitle')}
          </h2>
          <FontPicker
            fonts={fonts}
            current={currentFont}
            onChange={setCurrentFont}
            setError={setError}
            t={t}
          />

          {/* Prompts editáveis */}
          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t('studio.promptsTitle')}
          </h2>
          <div className="flex flex-col gap-4">
            {prompts.map((p) => (
              <PromptCard
                key={p.key}
                prompt={p}
                onChange={(updated) => setPrompts((prev) => prev.map((x) => (x.key === updated.key ? updated : x)))}
                setError={setError}
                t={t}
              />
            ))}
          </div>

          {/* Base de conhecimento */}
          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t('studio.knowledgeTitle')}
          </h2>
          <KnowledgePanel knowledge={knowledge} setKnowledge={setKnowledge} setError={setError} t={t} />
        </>
      )}
        </div>
      </div>
    </div>
  );
}

function PromptCard({
  prompt,
  onChange,
  setError,
  t,
}: {
  prompt: BlogPrompt;
  onChange: (p: BlogPrompt) => void;
  setError: (s: string | null) => void;
  t: (k: string) => string;
}) {
  const [text, setText] = useState(prompt.prompt);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [generating, setGenerating] = useState(false);

  const label = prompt.key === 'article' ? t('studio.promptArticle') : t('studio.promptIdeate');

  async function onSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await blogAiApi.savePrompt(prompt.key, text);
      onChange({ ...prompt, ...saved, is_default: false });
      setText(saved.prompt);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  async function onReset() {
    if (resetting) return;
    setResetting(true);
    setError(null);
    try {
      await blogAiApi.resetPrompt(prompt.key);
      const fresh = (await blogAiApi.listPrompts()).find((x) => x.key === prompt.key);
      if (fresh) {
        onChange(fresh);
        setText(fresh.prompt);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errorGeneric'));
    } finally {
      setResetting(false);
    }
  }

  async function onGenerate() {
    if (generating || !instruction.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const { prompt: generated } = await blogAiApi.generatePrompt(prompt.key, instruction.trim(), text);
      if (generated) setText(generated);
      setGenOpen(false);
      setInstruction('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errorGeneric'));
    } finally {
      setGenerating(false);
    }
  }

  const dirty = text.trim() !== prompt.prompt.trim();

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        {prompt.is_default ? (
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
            {t('studio.isDefault')}
          </span>
        ) : (
          <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
            {t('studio.isCustom')}
          </span>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-primary"
      />

      {genOpen && (
        <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3">
          <label className="mb-1.5 block text-xs font-medium text-foreground">{t('studio.genLabel')}</label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={t('studio.genPlaceholder')}
            rows={2}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating || !instruction.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? t('studio.generating') : t('studio.genRun')}
            </button>
            <button type="button" onClick={() => setGenOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">
              {t('studio.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : justSaved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {justSaved ? t('studio.saved') : t('studio.save')}
        </button>
        {!genOpen && (
          <button
            type="button"
            onClick={() => setGenOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
          >
            <Sparkles className="h-4 w-4" /> {t('studio.genButton')}
          </button>
        )}
        {!prompt.is_default && (
          <button
            type="button"
            onClick={onReset}
            disabled={resetting}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {t('studio.reset')}
          </button>
        )}
      </div>
    </div>
  );
}

function KnowledgePanel({
  knowledge,
  setKnowledge,
  setError,
  t,
}: {
  knowledge: BlogKnowledgeSource[];
  setKnowledge: React.Dispatch<React.SetStateAction<BlogKnowledgeSource[]>>;
  setError: (s: string | null) => void;
  t: (k: string) => string;
}) {
  const [type, setType] = useState<'url' | 'text'>('url');
  const [value, setValue] = useState('');
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function onAdd() {
    if (adding || !value.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const added = await blogAiApi.addKnowledge(type, value.trim(), title.trim() || undefined);
      setKnowledge((prev) => [added, ...prev]);
      setValue('');
      setTitle('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errorGeneric'));
    } finally {
      setAdding(false);
    }
  }

  async function onRemove(id: string) {
    setBusyId(id);
    try {
      await blogAiApi.removeKnowledge(id);
      setKnowledge((prev) => prev.filter((k) => k.id !== id));
    } catch {
      /* ignore */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <BookOpen className="h-4 w-4 text-primary" /> {t('studio.knowledgeHelp')}
      </p>

      {/* Add form */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as 'url' | 'text')}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="url">{t('studio.kUrl')}</option>
          <option value="text">{t('studio.kText')}</option>
        </select>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={type === 'url' ? 'https://…' : t('studio.kTextPlaceholder')}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={adding || !value.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t('studio.kAdd')}
        </button>
      </div>

      {/* List */}
      {knowledge.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {t('studio.kEmpty')}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {knowledge.map((k) => (
            <li key={k.id} className="flex items-start gap-3 rounded-lg border border-border bg-background p-3">
              {k.source_type === 'url' ? (
                <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              ) : (
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{k.title || k.value}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {k.source_type === 'url' ? k.value : (k.extracted_text ?? '').slice(0, 120)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(k.id)}
                disabled={busyId === k.id}
                className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                title={t('studio.kRemove')}
              >
                {busyId === k.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FontPicker({
  fonts,
  current,
  onChange,
  setError,
  t,
}: {
  fonts: BlogFontOption[];
  current: string | null;
  onChange: (slug: string) => void;
  setError: (s: string | null) => void;
  t: (k: string) => string;
}) {
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const selected = current ?? 'clash';
  const selFont = fonts.find((f) => f.slug === selected) ?? fonts[0];

  // agrupa por group, preservando a ordem do catálogo
  const groups: Array<{ name: string; items: BlogFontOption[] }> = [];
  for (const f of fonts) {
    let g = groups.find((x) => x.name === f.group);
    if (!g) {
      g = { name: f.group, items: [] };
      groups.push(g);
    }
    g.items.push(f);
  }

  async function pick(slug: string) {
    if (saving || slug === selected) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await blogAiApi.saveSettings({ display_font: slug });
      onChange(saved.display_font ?? slug);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {/* stylesheets de preview (todas as famílias + Clash via Fontshare) */}
      {previewFontHref(fonts) && <link rel="stylesheet" href={previewFontHref(fonts) as string} />}
      <link rel="stylesheet" href={CLASH_PREVIEW_HREF} />

      <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Type className="h-4 w-4 text-primary" /> {t('studio.fontHelp')}
      </p>

      {/* Preview ao vivo da fonte selecionada */}
      <div className="mb-4 rounded-lg border border-border bg-background p-5">
        <div className="truncate text-3xl text-foreground" style={{ fontFamily: selFont?.family, fontWeight: 600 }}>
          Como a IA escolhe quais produtos recomendar
        </div>
        <div className="mt-1 truncate text-base text-muted-foreground" style={{ fontFamily: selFont?.family, fontWeight: 400 }}>
          GEO · Inteligência Comercial · 0123456789
        </div>
      </div>

      {/* Dropdown agrupado */}
      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={(e) => pick(e.target.value)}
          disabled={saving}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
        >
          {groups.map((g) => (
            <optgroup key={g.name} label={g.name}>
              {g.items.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {saving ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        ) : justSaved ? (
          <Check className="h-4 w-4 shrink-0 text-primary" />
        ) : null}
      </div>
    </div>
  );
}
