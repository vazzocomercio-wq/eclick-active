'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Sparkles, Lock, Hash, Package, Search, X, Palette, Loader2 } from 'lucide-react';
import { useBrands } from '@/hooks/use-social';
import { socialApi, type ContentPillar, type SocialContent } from '@/lib/api/social';
import { bridgeApi, type SaasProduct, type CanvaDesign } from '@/lib/api/bridge';
import { Button } from '@/components/ui/button';
import { InstagramMockup } from '@/components/social/instagram-mockup';
import { cn } from '@/lib/utils';

type Tab = 'post' | 'carousel' | 'video';

/** Instagram recusa imagens http:// (exige https). Fotos do ML vêm em http. */
function toHttpsUrl(url: string): string {
  const u = (url ?? '').trim();
  if (u.startsWith('http://')) return 'https://' + u.slice('http://'.length);
  if (u.startsWith('//')) return 'https:' + u;
  return u;
}

const PILLARS: Array<[ContentPillar, string]> = [
  ['educational', 'Educacional'],
  ['promotional', 'Promocional'],
  ['social_proof', 'Prova social'],
  ['entertainment', 'Entretenimento'],
  ['institutional', 'Institucional'],
  ['engagement', 'Engajamento'],
  ['product', 'Produto'],
  ['behind_scenes', 'Bastidores'],
];

const STYLES: Array<[string, string]> = [
  ['minimalist', 'Minimalista'],
  ['vibrant', 'Vibrante'],
  ['professional', 'Profissional'],
  ['lifestyle', 'Lifestyle'],
  ['tech', 'Tech'],
  ['organic', 'Orgânico'],
];

const STRUCTURES: Array<[string, string]> = [
  ['tutorial', 'Educativo passo a passo'],
  ['storytelling', 'Storytelling'],
  ['list', 'Lista'],
  ['comparison', 'Comparativo'],
  ['before_after', 'Antes e depois'],
  ['free', 'Auto-livre'],
];

export default function CreateContentPage() {
  const router = useRouter();
  const { brands } = useBrands();
  const [tab, setTab] = useState<Tab>('post');

  const [brandId, setBrandId] = useState<string>('');
  const [pillar, setPillar] = useState<ContentPillar>('educational');
  const [theme, setTheme] = useState('');
  const [hook, setHook] = useState('');
  const [cta, setCta] = useState('');
  const [visualStyle, setVisualStyle] = useState('professional');
  const [slideCount, setSlideCount] = useState(7);
  const [structure, setStructure] = useState('free');

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<SocialContent | null>(null);
  const [suggestedTags, setSuggestedTags] = useState<{
    hashtags: string[];
    rationale: string;
  } | null>(null);
  const [tagsLoading, setTagsLoading] = useState(false);

  // Catalog-aware: produto do catálogo do SaaS (via bridge)
  const [products, setProducts] = useState<SaasProduct[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<SaasProduct | null>(null);
  const [showProductList, setShowProductList] = useState(false);

  // Canva como imagem do post (via bridge → SaaS exporta o design pra https)
  const [canvaDesigns, setCanvaDesigns] = useState<CanvaDesign[]>([]);
  const [canvaSearch, setCanvaSearch] = useState('');
  const [showCanvaList, setShowCanvaList] = useState(false);
  const [canvaLoading, setCanvaLoading] = useState(false);
  const [canvaExportingId, setCanvaExportingId] = useState<string | null>(null);
  const [selectedCanva, setSelectedCanva] = useState<
    { design: CanvaDesign; exportedUrl: string } | null
  >(null);

  useEffect(() => {
    if (!brandId && brands.length > 0 && brands[0]) setBrandId(brands[0].id);
  }, [brands, brandId]);

  // Busca produtos (debounce) quando a lista está aberta
  useEffect(() => {
    if (!showProductList) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      bridgeApi
        .listProducts({ search: productSearch.trim() || undefined, limit: 40 }, ctrl.signal)
        .then(setProducts)
        .catch(() => { /* fallback vazio */ });
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [productSearch, showProductList]);

  const pickProduct = (p: SaasProduct) => {
    setSelectedProduct(p);
    setShowProductList(false);
    setProductSearch('');
    setPillar('product');
    const priceTxt = p.price != null ? ` Preço: R$ ${Number(p.price).toFixed(2)}.` : '';
    setTheme(
      `Post sobre o produto "${p.title ?? p.sku}".${p.category ? ` Categoria: ${p.category}.` : ''}${priceTxt} ` +
        `Destaque os benefícios e o diferencial, e convide a comprar.`,
    );
  };

  const clearProduct = () => {
    setSelectedProduct(null);
    setTheme('');
  };

  // Busca designs do Canva (debounce) quando a lista está aberta
  useEffect(() => {
    if (!showCanvaList) return;
    const ctrl = new AbortController();
    setCanvaLoading(true);
    const t = setTimeout(() => {
      bridgeApi
        .listCanvaDesigns(canvaSearch.trim() || undefined, ctrl.signal)
        .then((r) => setCanvaDesigns(r.designs ?? []))
        .catch(() => { /* fallback vazio */ })
        .finally(() => setCanvaLoading(false));
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [canvaSearch, showCanvaList]);

  // Exportar o design escolhido pra https estável é lento (job do Canva).
  // Faz na hora do pick, com spinner; só fixa quando a URL chega.
  const pickCanva = async (d: CanvaDesign) => {
    setCanvaExportingId(d.id);
    try {
      const { url } = await bridgeApi.exportCanvaDesign(d.id);
      if (!url) {
        alert('Não foi possível exportar este design do Canva. Tente outro.');
        return;
      }
      setSelectedCanva({ design: d, exportedUrl: url });
      setShowCanvaList(false);
      setCanvaSearch('');
    } catch (err) {
      alert(`Erro ao exportar do Canva: ${err instanceof Error ? err.message : 'desconhecido'}`);
    } finally {
      setCanvaExportingId(null);
    }
  };

  const clearCanva = () => setSelectedCanva(null);

  const generate = async () => {
    if (!brandId || !theme.trim()) return;
    setGenerating(true);
    setResult(null);
    try {
      const body = {
        brand_id: brandId,
        theme: theme.trim(),
        pillar,
        hook: hook.trim() || undefined,
        cta: cta.trim() || undefined,
        visual_style: visualStyle,
      };
      let r =
        tab === 'carousel'
          ? await socialApi.generate.carousel({
              ...body,
              slide_count: slideCount,
              structure: structure as Parameters<typeof socialApi.generate.carousel>[0]['structure'],
            })
          : await socialApi.generate.post(body);

      // Imagem do post: a IA do Active cai num SVG placeholder não-publicável.
      // Sobrescrevemos por uma imagem real https (o Instagram recusa http/SVG
      // → "Media ID is not available"). Precedência:
      //   1. design do Canva escolhido (visual branded do usuário)
      //   2. foto real do produto do catálogo
      const override =
        selectedCanva
          ? { url: selectedCanva.exportedUrl, source: 'canva' as const, alt: selectedCanva.design.title }
          : selectedProduct?.thumbnail_url
            ? { url: toHttpsUrl(selectedProduct.thumbnail_url), source: 'catalog' as const, alt: selectedProduct.title ?? '' }
            : null;
      if (override) {
        try {
          r = await socialApi.contents.update(r.id, {
            cover_image_url: override.url,
            ...(selectedProduct ? { related_product_id: selectedProduct.id } : {}),
            media: [
              {
                url: override.url,
                width: 1080,
                height: 1080,
                source: override.source,
                alt_text: override.alt,
              },
            ],
          });
        } catch { /* mantém a imagem gerada se o PATCH falhar */ }
      }
      setResult(r);
    } catch (err) {
      alert(`Erro ao gerar: ${err instanceof Error ? err.message : 'desconhecido'}`);
    } finally {
      setGenerating(false);
    }
  };

  const goToDetail = () => {
    if (result) router.push(`/social/conteudo/${result.id}`);
  };

  const suggestHashtags = async () => {
    if (!brandId || !theme.trim()) return;
    setTagsLoading(true);
    try {
      const r = await socialApi.hashtags.suggest({
        brand_id: brandId,
        theme: theme.trim(),
      });
      setSuggestedTags(r);
    } catch {
      setSuggestedTags(null);
    } finally {
      setTagsLoading(false);
    }
  };

  if (brands.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Você precisa configurar uma marca antes de gerar conteúdos.
        </p>
        <Button asChild size="sm">
          <Link href="/social/marcas">Criar marca</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/social">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Criar conteúdo</h1>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-border px-4">
        <div className="flex gap-1">
          {([
            ['post', '📸 Post estático'],
            ['carousel', '🎴 Carrossel'],
            ['video', '🔒 Vídeo/Reel'],
          ] as Array<[Tab, string]>).map(([k, l]) => (
            <button
              key={k}
              type="button"
              disabled={k === 'video'}
              onClick={() => setTab(k)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === k
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground',
                k === 'video' ? 'cursor-not-allowed opacity-60' : 'hover:text-foreground',
              )}
            >
              {l}
              {k === 'video' && (
                <span className="ml-1 inline-flex items-center gap-0.5 rounded-md bg-muted px-1 text-[9px] uppercase">
                  <Lock className="h-2.5 w-2.5" />
                  Em breve
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 p-4 lg:grid-cols-2 md:p-6">
          {/* Brief */}
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Brief</h2>

            <Field label="Marca">
              <select
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Pilar">
              <select
                value={pillar}
                onChange={(e) => setPillar(e.target.value as ContentPillar)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                {PILLARS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Produto do catálogo (opcional)">
              {selectedProduct ? (
                <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
                  {selectedProduct.thumbnail_url && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={selectedProduct.thumbnail_url} alt="" className="h-10 w-10 rounded object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{selectedProduct.title ?? selectedProduct.sku}</p>
                    {selectedProduct.price != null && (
                      <p className="text-[10px] text-muted-foreground">R$ {Number(selectedProduct.price).toFixed(2)}</p>
                    )}
                  </div>
                  <button type="button" onClick={clearProduct} className="p-1 text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : showProductList ? (
                <div className="rounded-md border border-border bg-background">
                  <div className="relative border-b border-border">
                    <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      autoFocus
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="Buscar produto…"
                      className="w-full bg-transparent py-1.5 pl-7 pr-2 text-sm outline-none"
                    />
                  </div>
                  <div className="max-h-52 overflow-y-auto">
                    {products.length === 0 ? (
                      <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                        {productSearch ? 'Nada encontrado.' : 'Digite pra buscar no catálogo…'}
                      </p>
                    ) : (
                      products.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => pickProduct(p)}
                          className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted"
                        >
                          {p.thumbnail_url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={p.thumbnail_url} alt="" className="h-8 w-8 rounded object-cover" />
                          ) : (
                            <span className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                              <Package className="h-3.5 w-3.5 text-muted-foreground" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate text-xs">{p.title ?? p.sku}</span>
                        </button>
                      ))
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setShowProductList(false); setProductSearch(''); }}
                    className="w-full border-t border-border py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowProductList(true)}
                  className="flex w-full items-center gap-2 rounded-md border border-dashed border-border bg-background px-2 py-2 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
                >
                  <Package className="h-4 w-4" />
                  Escolher um produto pra IA criar o post (usa a foto real)
                </button>
              )}
            </Field>

            <Field label="Imagem do post (opcional)">
              {selectedCanva ? (
                <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedCanva.design.thumbnailUrl ?? selectedCanva.exportedUrl}
                    alt=""
                    className="h-10 w-10 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{selectedCanva.design.title}</p>
                    <p className="text-[10px] text-muted-foreground">Design do Canva</p>
                  </div>
                  <button type="button" onClick={clearCanva} className="p-1 text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : showCanvaList ? (
                <div className="rounded-md border border-border bg-background">
                  <div className="relative border-b border-border">
                    <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      autoFocus
                      value={canvaSearch}
                      onChange={(e) => setCanvaSearch(e.target.value)}
                      placeholder="Buscar design no Canva…"
                      className="w-full bg-transparent py-1.5 pl-7 pr-2 text-sm outline-none"
                    />
                  </div>
                  <div className="max-h-52 overflow-y-auto">
                    {canvaLoading ? (
                      <p className="flex items-center justify-center gap-1.5 px-2 py-3 text-center text-[11px] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Carregando designs…
                      </p>
                    ) : canvaDesigns.length === 0 ? (
                      <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                        {canvaSearch ? 'Nada encontrado.' : 'Nenhum design encontrado. Conecte o Canva no SaaS.'}
                      </p>
                    ) : (
                      canvaDesigns.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          disabled={canvaExportingId !== null}
                          onClick={() => pickCanva(d)}
                          className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted disabled:opacity-50"
                        >
                          {d.thumbnailUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={d.thumbnailUrl} alt="" className="h-8 w-8 rounded object-cover" />
                          ) : (
                            <span className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                              <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate text-xs">{d.title}</span>
                          {canvaExportingId === d.id && (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setShowCanvaList(false); setCanvaSearch(''); }}
                    className="w-full border-t border-border py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCanvaList(true)}
                  className="flex w-full items-center gap-2 rounded-md border border-dashed border-border bg-background px-2 py-2 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
                >
                  <Palette className="h-4 w-4" />
                  Usar um design do Canva como imagem do post
                </button>
              )}
            </Field>

            <Field label="Tema (sobre o que é o post?)" required>
              <textarea
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="Ex: como escolher o lustre certo pra sala"
                rows={3}
                className="w-full rounded-md border border-border bg-background p-2 text-sm"
              />
            </Field>

            <Field label="Hook (opcional)">
              <input
                value={hook}
                onChange={(e) => setHook(e.target.value)}
                placeholder="IA sugere se vazio"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </Field>

            <Field label="CTA (opcional)">
              <input
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="Usa o CTA da marca se vazio"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </Field>

            <Field label="Estilo visual">
              <select
                value={visualStyle}
                onChange={(e) => setVisualStyle(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                {STYLES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>

            {tab === 'carousel' && (
              <>
                <Field label={`Número de slides: ${slideCount}`}>
                  <input
                    type="range"
                    min={3}
                    max={10}
                    value={slideCount}
                    onChange={(e) => setSlideCount(Number(e.target.value))}
                    className="w-full"
                  />
                </Field>
                <Field label="Estrutura">
                  <select
                    value={structure}
                    onChange={(e) => setStructure(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  >
                    {STRUCTURES.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}

            {/* Hashtag preview */}
            {theme.trim().length > 5 && (
              <div className="rounded-md border border-border bg-muted/20 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Hashtags sugeridas pela IA
                  </span>
                  <button
                    type="button"
                    onClick={suggestHashtags}
                    disabled={tagsLoading || !brandId}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] hover:bg-muted disabled:opacity-50"
                  >
                    <Hash className="h-3 w-3" />
                    {tagsLoading ? 'IA…' : suggestedTags ? 'Refazer' : 'Sugerir'}
                  </button>
                </div>
                {suggestedTags && (
                  <>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {suggestedTags.hashtags.map((h) => (
                        <span
                          key={h}
                          className="rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] text-blue-600 dark:text-blue-400"
                        >
                          #{h}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] italic text-muted-foreground">
                      {suggestedTags.rationale}
                    </p>
                  </>
                )}
              </div>
            )}

            <Button onClick={generate} disabled={generating || !theme.trim()}>
              <Sparkles className="h-3.5 w-3.5" />
              <span className="ml-1">
                {generating
                  ? `Gerando ${tab === 'carousel' ? 'carrossel' : 'post'}…`
                  : 'Gerar agora'}
              </span>
            </Button>
            {generating && (
              <p className="text-xs text-muted-foreground">
                A IA está pensando, escrevendo e gerando imagens. Pode levar 15-45s.
              </p>
            )}
          </div>

          {/* Preview */}
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Preview</h2>
            {result ? (
              <>
                <InstagramMockup
                  content={result}
                  brand={brands.find((b) => b.id === result.brand_id)}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setResult(null)}>
                    Limpar
                  </Button>
                  <Button size="sm" onClick={goToDetail}>
                    Ir para detalhe →
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                {generating
                  ? '✨ Gerando conteúdo… imagens em alguns segundos'
                  : 'Preencha o brief e clique em "Gerar agora"'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}
