'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { useBrand } from '@/hooks/use-social';
import { socialApi, type SocialBrand, type EmojiUsage, type HashtagStrategy } from '@/lib/api/social';
import { Button } from '@/components/ui/button';

type Tab = 'identity' | 'visual' | 'voice' | 'knowledge' | 'references';

export default function BrandEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? null;
  const { brand, loading, refresh } = useBrand(id);

  const [tab, setTab] = useState<Tab>('identity');
  const [form, setForm] = useState<Partial<SocialBrand> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (brand) setForm(brand);
  }, [brand]);

  if (loading || !brand || !form) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Carregando marca…
      </div>
    );
  }

  const save = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await socialApi.brands.update(id, form);
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    if (!confirm('Inativar esta marca?')) return;
    await socialApi.brands.delete(id);
    router.push('/social/marcas');
  };

  const set = <K extends keyof SocialBrand>(key: K, value: SocialBrand[K]) =>
    setForm((f) => ({ ...(f ?? {}), [key]: value }));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/social/marcas">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg font-semibold leading-tight">{brand.name}</h1>
            <p className="text-xs text-muted-foreground">/{brand.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={remove}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            <Save className="h-3.5 w-3.5" />
            <span className="ml-1">{saving ? 'Salvando…' : 'Salvar'}</span>
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-border px-4">
        <div className="flex gap-1 overflow-x-auto">
          {([
            ['identity', 'Identidade'],
            ['visual', 'Visual'],
            ['voice', 'Tom de voz'],
            ['knowledge', 'Conhecimento'],
            ['references', 'Referências'],
          ] as Array<[Tab, string]>).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === k
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {tab === 'identity' && (
          <div className="grid max-w-3xl grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Nome" value={form.name ?? ''} onChange={(v) => set('name', v)} />
            <Field label="Nicho" value={form.niche ?? ''} onChange={(v) => set('niche', v)} placeholder="Ex: e-commerce de iluminação" />
            <Field
              label="Público-alvo"
              value={form.target_audience ?? ''}
              onChange={(v) => set('target_audience', v)}
              placeholder="Ex: arquitetos e designers"
              fullWidth
            />
            <FieldArea
              label="Proposta de valor"
              value={form.value_proposition ?? ''}
              onChange={(v) => set('value_proposition', v)}
              fullWidth
            />
            <FieldArea
              label="Descrição"
              value={form.description ?? ''}
              onChange={(v) => set('description', v)}
              fullWidth
            />
            <Field
              label="CTA principal"
              value={form.main_cta ?? ''}
              onChange={(v) => set('main_cta', v)}
              placeholder="Ex: Compre agora no link da bio"
              fullWidth
            />
            <FieldArrayChips
              label="Diferenciais"
              value={form.differentials ?? []}
              onChange={(v) => set('differentials', v)}
              placeholder="Ex: 'Frete grátis', 'Garantia 5 anos'…"
              fullWidth
            />
            <FieldArrayChips
              label="Dores do público"
              value={form.pain_points ?? []}
              onChange={(v) => set('pain_points', v)}
              placeholder="Adicione 1 por vez (Enter)"
              fullWidth
            />
          </div>
        )}

        {tab === 'visual' && (
          <div className="grid max-w-2xl grid-cols-1 gap-3 md:grid-cols-2">
            <ColorField
              label="Cor primária"
              value={form.primary_color ?? '#00E5FF'}
              onChange={(v) => set('primary_color', v)}
            />
            <ColorField
              label="Cor secundária"
              value={form.secondary_color ?? '#4ADE50'}
              onChange={(v) => set('secondary_color', v)}
            />
            <Field
              label="URL do logo"
              value={form.logo_url ?? ''}
              onChange={(v) => set('logo_url', v)}
              placeholder="https://…"
              fullWidth
            />
            <Field
              label="Canva Brand Kit ID (opcional)"
              value={form.canva_brand_kit_id ?? ''}
              onChange={(v) => set('canva_brand_kit_id', v)}
              fullWidth
            />
            <div className="md:col-span-2">
              <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                Preview do gradient
              </p>
              <div
                className="h-32 rounded-lg"
                style={{
                  background: `linear-gradient(135deg, ${form.primary_color}, ${form.secondary_color})`,
                }}
              />
            </div>
          </div>
        )}

        {tab === 'voice' && (
          <div className="grid max-w-2xl grid-cols-1 gap-3 md:grid-cols-2">
            <SelectField
              label="Tom de voz"
              value={form.tone_of_voice ?? 'professional'}
              onChange={(v) => set('tone_of_voice', v)}
              options={[
                ['professional', 'Profissional'],
                ['friendly', 'Amigável'],
                ['casual', 'Casual'],
                ['authoritative', 'Autoritário'],
                ['playful', 'Divertido'],
                ['inspirational', 'Inspiracional'],
              ]}
            />
            <SelectField
              label="Uso de emoji"
              value={form.emoji_usage ?? 'moderate'}
              onChange={(v) => set('emoji_usage', v as EmojiUsage)}
              options={[
                ['none', 'Nenhum'],
                ['minimal', 'Mínimo'],
                ['moderate', 'Moderado'],
                ['heavy', 'Intenso'],
              ]}
            />
            <SelectField
              label="Estratégia de hashtags"
              value={form.hashtag_strategy ?? 'mixed'}
              onChange={(v) => set('hashtag_strategy', v as HashtagStrategy)}
              options={[
                ['niche', 'Niche (segmentada)'],
                ['broad', 'Ampla'],
                ['mixed', 'Mista'],
                ['minimal', 'Mínima'],
              ]}
            />
            <FieldArrayChips
              label="Palavras preferidas"
              value={form.preferred_words ?? []}
              onChange={(v) => set('preferred_words', v)}
              fullWidth
            />
            <FieldArrayChips
              label="Palavras proibidas"
              value={form.forbidden_words ?? []}
              onChange={(v) => set('forbidden_words', v)}
              fullWidth
            />
          </div>
        )}

        {tab === 'knowledge' && (
          <div className="max-w-2xl">
            <FieldArrayChips
              label="Categorias da Base de Conhecimento"
              value={form.knowledge_categories ?? []}
              onChange={(v) => set('knowledge_categories', v)}
              placeholder="Ex: produtos, política, faq"
              fullWidth
            />
            <p className="mt-2 text-xs text-muted-foreground">
              A IA vai consultar documentos das categorias acima ao gerar conteúdo —
              garante consistência de informação (preços, políticas, benefícios reais).
            </p>
            <div className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs">
              <p className="font-medium">💡 Dica:</p>
              <p className="mt-1">
                Cadastre documentos em{' '}
                <Link href="/conhecimento" className="text-primary underline">
                  /conhecimento
                </Link>{' '}
                e use a categoria pra agrupá-los. A IA usa RAG (busca semântica) pra
                pegar os trechos mais relevantes a cada geração.
              </p>
            </div>
          </div>
        )}

        {tab === 'references' && (
          <div className="grid max-w-2xl grid-cols-1 gap-3">
            <FieldArrayChips
              label="Contas concorrentes (handles)"
              value={form.reference_accounts ?? []}
              onChange={(v) => set('reference_accounts', v)}
              placeholder="@conta1, @conta2…"
            />
            <p className="text-xs text-muted-foreground">
              Apenas referência — a IA não acessa essas contas, mas pode considerar o
              estilo se mencionado.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Form fields ──────────────────────────────────

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  fullWidth?: boolean;
}

function Field({ label, value, onChange, placeholder, fullWidth }: FieldProps) {
  return (
    <label className={fullWidth ? 'md:col-span-2' : ''}>
      <span className="block text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
      />
    </label>
  );
}

function FieldArea({ label, value, onChange, fullWidth }: FieldProps) {
  return (
    <label className={fullWidth ? 'md:col-span-2' : ''}>
      <span className="block text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm focus:border-primary focus:outline-none"
      />
    </label>
  );
}

function ColorField({ label, value, onChange }: FieldProps) {
  return (
    <label>
      <span className="block text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-border bg-background"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono"
        />
      </div>
    </label>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}

function SelectField({ label, value, onChange, options }: SelectFieldProps) {
  return (
    <label>
      <span className="block text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
      >
        {options.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

interface FieldArrayChipsProps {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  fullWidth?: boolean;
}

function FieldArrayChips({
  label,
  value,
  onChange,
  placeholder,
  fullWidth,
}: FieldArrayChipsProps) {
  const [draft, setDraft] = useState('');
  return (
    <div className={fullWidth ? 'md:col-span-2' : ''}>
      <span className="block text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="mt-1 flex flex-wrap items-center gap-1 rounded-md border border-border bg-background p-2">
        {value.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="text-muted-foreground hover:text-red-600"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault();
              onChange([...value, draft.trim()]);
              setDraft('');
            } else if (e.key === 'Backspace' && !draft && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          placeholder={placeholder ?? 'Pressione Enter pra adicionar'}
          className="flex-1 min-w-[120px] bg-transparent text-sm focus:outline-none"
        />
      </div>
    </div>
  );
}
