'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Sparkles, Hash, Package, Search, X, Palette, Loader2, Clapperboard, Rocket } from 'lucide-react';
import { useBrands } from '@/hooks/use-social';
import { socialApi, type ContentPillar, type SocialContent } from '@/lib/api/social';
import { bridgeApi, type SaasProduct, type CanvaDesign } from '@/lib/api/bridge';
import { VIDEO_STYLES, SCRIPT_FRAMEWORKS, VIDEO_MODELS } from '@/lib/social/video-styles';
import { useStyleCatalog } from '@/lib/social/use-style-catalog';
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
  const { findStyle, findFramework } = useStyleCatalog();
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

  // Reel / vídeo (tab 'video')
  const [videoMode, setVideoMode] = useState<'product_photo' | 'ai_scene'>('product_photo');
  const [styleId, setStyleId] = useState<string>('ficha');
  const [frameworkId, setFrameworkId] = useState<string>('dsb');
  const [duration, setDuration] = useState<number>(10);
  const [model, setModel] = useState<string>('sora-2');
  const [reelStatus, setReelStatus] = useState<string>('idle');
  const [pollId, setPollId] = useState<string | null>(null);
  // E1: qual foto do produto vira a base do vídeo (null = capa)
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  // E3: multi-cena (anima várias fotos do produto e concatena)
  const [multiScene, setMultiScene] = useState(false);
  // UGC com avatar (D-ID): produto no fundo + avatar pequeno falando o texto
  const [avatarOverlay, setAvatarOverlay] = useState(false);
  const [avatarCorner, setAvatarCorner] = useState<'br' | 'bl' | 'tr' | 'tl'>('br');
  const [avatarSizePct, setAvatarSizePct] = useState<number>(30);

  // Autopilot de Campanha — "Gerar campanha completa"
  const [recipe, setRecipe] = useState<import('@/lib/api/social').SocialCampaignRecipe | null>(null);
  const [campaignBusy, setCampaignBusy] = useState(false);
  const [campaignError, setCampaignError] = useState<string | null>(null);

  useEffect(() => {
    if (!brandId && brands.length > 0 && brands[0]) setBrandId(brands[0].id);
  }, [brands, brandId]);

  // 1-clique do Radar de Conteúdo: pré-preenche a partir de uma pauta (brief).
  // Lê query params via window.location (client-only) pra evitar Suspense no build.
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (prefilled || typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    const fmt = p.get('format');
    const theme0 = p.get('theme');
    const hook0 = p.get('hook');
    const pid = p.get('product_id');
    const psearch = p.get('product_search');
    if (!fmt && !theme0 && !hook0 && !pid && !psearch) return;
    setPrefilled(true);
    if (fmt === 'reel' || fmt === 'video') setTab('video');
    else if (fmt === 'carousel') setTab('carousel');
    else if (fmt === 'post') setTab('post');
    if (theme0) setTheme(theme0);
    if (hook0) setHook(hook0);
    if (pid || psearch) {
      bridgeApi
        .listProducts({ search: psearch || undefined, limit: 40 })
        .then((prods) => {
          const found = pid ? prods.find((x) => x.id === pid) : undefined;
          if (found) {
            setSelectedProduct(found);
            setPillar('product');
          } else if (psearch) {
            setProductSearch(psearch);
            setShowProductList(true);
          }
        })
        .catch(() => {
          /* fallback: deixa o usuário escolher manualmente */
        });
    }
  }, [prefilled]);

  // Carrega a receita default da org (pro botão "Gerar campanha completa")
  useEffect(() => {
    const ctrl = new AbortController();
    socialApi.recipes
      .getDefault(ctrl.signal)
      .then(setRecipe)
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  async function handleGenerateCampaign() {
    if (!brandId || !selectedProduct?.thumbnail_url || campaignBusy) return;
    setCampaignBusy(true);
    setCampaignError(null);
    try {
      const styleIds =
        recipe?.allowed_video_styles?.length
          ? recipe.allowed_video_styles
          : ['360', 'cinemagraph', 'hook_payoff', 'storytelling'];
      const fwIds =
        recipe?.allowed_frameworks?.length
          ? recipe.allowed_frameworks
          : ['dsb', 'aida', 'pas'];
      const video_styles = styleIds
        .map(findStyle)
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => ({ id: s.id, label: s.label, prompt: s.hint, camera: s.camera }));
      const frameworks = fwIds
        .map(findFramework)
        .filter((f): f is NonNullable<typeof f> => !!f)
        .map((f) => ({ id: f.id, label: f.label, prompt: f.hint }));
      const photo = toHttpsUrl(selectedImageUrl ?? selectedProduct.thumbnail_url ?? '');
      const photos = (selectedProduct.photos ?? []).map(toHttpsUrl);
      const campaign = await socialApi.campaigns.generate({
        brand_id: brandId,
        recipe_id: recipe?.id ?? null,
        product_ref: selectedProduct.id,
        product_name: selectedProduct.title ?? selectedProduct.sku ?? 'Produto',
        product_photo_url: photo,
        product_photos: photos.length > 1 ? photos : undefined,
        product_description: selectedProduct.description ?? undefined,
        category: selectedProduct.category ?? undefined,
        video_styles,
        frameworks,
      });
      router.push(`/social/campanhas/${campaign.id}`);
    } catch (e) {
      setCampaignError(e instanceof Error ? e.message : 'Falha ao iniciar a campanha');
      setCampaignBusy(false);
    }
  }

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
    setSelectedImageUrl(null); // volta pra capa ao trocar de produto
    setMultiScene(false);
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

  // Poll do vídeo do reel (motor do SaaS é assíncrono — minutos). Quando o
  // backend anexa o vídeo, o conteúdo vem com media[] e status pending_approval.
  useEffect(() => {
    if (!pollId) return;
    let active = true;
    const tick = async () => {
      try {
        const r = await socialApi.reelStatus(pollId);
        if (!active) return;
        setReelStatus(r.video_status);
        if (r.video_status === 'completed' || r.video_status === 'failed') {
          setResult(r.content);
          setPollId(null);
        }
      } catch {
        /* mantém tentando no próximo tick */
      }
    };
    void tick();
    const iv = setInterval(tick, 6000);
    return () => {
      active = false;
      clearInterval(iv);
    };
  }, [pollId]);

  const generateReel = async () => {
    if (!brandId || !selectedProduct?.thumbnail_url) return;
    setGenerating(true);
    setResult(null);
    setReelStatus('generating');
    try {
      const style = findStyle(styleId);
      const framework = findFramework(frameworkId);
      const r = await socialApi.generate.reel({
        brand_id: brandId,
        theme: theme.trim() || (selectedProduct.title ?? 'produto'),
        pillar: 'product',
        hook: hook.trim() || undefined,
        cta: cta.trim() || undefined,
        catalog_product_id: selectedProduct.id,
        product_title: selectedProduct.title ?? undefined,
        product_photo_url: toHttpsUrl(selectedImageUrl ?? selectedProduct.thumbnail_url ?? ''),
        category: selectedProduct.category ?? undefined,
        product_description: selectedProduct.description ?? undefined,
        video_mode: videoMode,
        style: style?.id,
        style_label: style?.label,
        style_prompt: style?.hint,
        framework: framework?.id,
        framework_label: framework?.label,
        framework_prompt: framework?.hint,
        aspect_ratio: '9:16',
        duration_seconds: duration,
        model_name: model,
        camera_motion: style?.camera,
        multi_scene: multiScene && (selectedProduct.photos?.length ?? 0) > 1,
        photo_urls: multiScene ? (selectedProduct.photos ?? []).slice(0, 4) : undefined,
        avatar_overlay: avatarOverlay && !multiScene ? true : undefined,
        avatar_position: avatarOverlay ? avatarCorner : undefined,
        avatar_size_pct: avatarOverlay ? avatarSizePct : undefined,
      });
      setResult(r);
      // status='generating' → começa o poll; se já veio failed (motor off), mostra erro
      const meta = (r.metadata ?? {}) as { video_job_id?: string | null };
      if (r.status === 'failed' || !meta.video_job_id) {
        setReelStatus('failed');
      } else {
        setReelStatus('generating');
        setPollId(r.id);
      }
    } catch (err) {
      alert(`Erro ao gerar reel: ${err instanceof Error ? err.message : 'desconhecido'}`);
      setReelStatus('failed');
    } finally {
      setGenerating(false);
    }
  };

  const clearResult = () => {
    setResult(null);
    setPollId(null);
    setReelStatus('idle');
  };

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
      const productImg = selectedProduct
        ? toHttpsUrl(selectedImageUrl ?? selectedProduct.thumbnail_url ?? '')
        : '';
      const override =
        selectedCanva
          ? { url: selectedCanva.exportedUrl, source: 'canva' as const, alt: selectedCanva.design.title }
          : productImg
            ? { url: productImg, source: 'catalog' as const, alt: selectedProduct?.title ?? '' }
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
            ['video', '🎬 Vídeo/Reel'],
          ] as Array<[Tab, string]>).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === k
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {l}
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

            {tab !== 'video' && (
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
            )}

            <Field label={tab === 'video' ? 'Produto do catálogo (obrigatório)' : 'Produto do catálogo (opcional)'}>
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

            {selectedProduct && (
              <div className="rounded-lg border border-primary/30 bg-gradient-to-br from-primary/5 to-transparent p-3">
                <div className="flex items-start gap-2">
                  <Rocket className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold">Gerar campanha completa</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      A IA cria de uma vez{' '}
                      {recipe
                        ? `${recipe.num_reels} reels + ${recipe.num_carousels} carrossel + ${recipe.num_posts} posts`
                        : 'vários reels, carrosséis e posts'}{' '}
                      sobre este produto — com legendas, hashtags e agenda, tudo na fila de aprovação.
                    </p>
                    {campaignError && (
                      <p className="mt-1 text-[11px] text-red-500">{campaignError}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleGenerateCampaign}
                        disabled={campaignBusy || !brandId}
                      >
                        {campaignBusy ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Rocket className="mr-1 h-3.5 w-3.5" />
                        )}
                        {campaignBusy ? 'Iniciando…' : 'Gerar campanha completa'}
                      </Button>
                      <Link
                        href="/social/automacao"
                        className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                      >
                        Configurar receita
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {selectedProduct && !(tab === 'video' && multiScene) && (selectedProduct.photos?.length ?? 0) > 1 && (
              <Field label={tab === 'video' ? 'Imagem base do vídeo' : 'Imagem do produto (qual foto usar)'}>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {selectedProduct.photos!.map((url) => {
                    const active = (selectedImageUrl ?? selectedProduct.thumbnail_url) === url;
                    return (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setSelectedImageUrl(url)}
                        className={cn(
                          'h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 transition',
                          active ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100',
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {tab === 'video'
                    ? 'Escolha qual foto vira o 1º quadro do vídeo (padrão: a capa).'
                    : 'Escolha qual foto do produto usar no post (padrão: a capa).'}
                </p>
              </Field>
            )}

            {tab === 'video' && (
              <>
                <Field label="Como gerar o vídeo">
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ['product_photo', 'Animar a foto', 'Dá movimento na foto real do produto'],
                      ['ai_scene', 'Cena por IA', 'Cria uma cena nova com o produto'],
                    ] as Array<['product_photo' | 'ai_scene', string, string]>).map(([k, l, d]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setVideoMode(k)}
                        className={cn(
                          'rounded-md border p-2 text-left transition-colors',
                          videoMode === k
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/40',
                        )}
                      >
                        <span className="block text-xs font-medium">{l}</span>
                        <span className="block text-[10px] text-muted-foreground">{d}</span>
                      </button>
                    ))}
                  </div>
                </Field>

                {selectedProduct && (selectedProduct.photos?.length ?? 0) > 1 && (
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background p-2 text-xs">
                    <input
                      type="checkbox"
                      checked={multiScene}
                      onChange={(e) => setMultiScene(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      🎬 <strong>Multi-cena</strong> — anima {Math.min(selectedProduct.photos!.length, 4)} fotos do produto e junta num reel só.
                    </span>
                  </label>
                )}

                <Field label="Estilo do vídeo">
                  <select
                    value={styleId}
                    onChange={(e) => setStyleId(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  >
                    <optgroup label="🟢 Recomendados (saem bem)">
                      {VIDEO_STYLES.filter((s) => s.tier === 'strong').map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="🟡 Experimentais (qualidade varia)">
                      {VIDEO_STYLES.filter((s) => s.tier === 'experimental').map((s) => (
                        <option key={s.id} value={s.id}>{s.label} — experimental</option>
                      ))}
                    </optgroup>
                  </select>
                  {findStyle(styleId)?.tier === 'experimental' && (
                    <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                      ⚠️ Estilo experimental: depende de pessoa/áudio/cena — a fidelidade ao produto pode variar.
                    </p>
                  )}
                </Field>

                <Field label="Estrutura do roteiro (legenda)">
                  <select
                    value={frameworkId}
                    onChange={(e) => setFrameworkId(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  >
                    {SCRIPT_FRAMEWORKS.map((f) => (
                      <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label={`Duração: ${duration}s`}>
                  <input
                    type="range"
                    min={5}
                    max={20}
                    step={5}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="w-full"
                  />
                </Field>

                <Field label="Modelo de IA">
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  >
                    <optgroup label="🎬 Recomendados (sem texto chinês)">
                      {VIDEO_MODELS.filter((m) => !m.id.startsWith('kling')).map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="💲 Kling (mais barato, pode ter texto chinês)">
                      {VIDEO_MODELS.filter((m) => m.id.startsWith('kling')).map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </optgroup>
                  </select>
                  {!VIDEO_MODELS.find((m) => m.id === model)?.ready && (
                    <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                      ⚠️ Esse modelo ainda não está configurado no servidor — a geração vai falhar até conectarmos a chave dele.
                    </p>
                  )}
                </Field>

                <Field label="UGC com avatar (D-ID)">
                  <label className="flex items-start gap-2 text-xs text-foreground/80">
                    <input
                      type="checkbox"
                      checked={avatarOverlay}
                      onChange={(e) => setAvatarOverlay(e.target.checked)}
                      disabled={multiScene}
                      className="mt-0.5"
                    />
                    <span>
                      Avatar pequeno falando o texto sobre o vídeo do produto
                      (picture-in-picture).
                      {multiScene && ' Desative o multi-cena pra usar.'}
                    </span>
                  </label>
                  {avatarOverlay && (
                    <>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="text-[11px] text-muted-foreground">
                          Posição
                          <select
                            value={avatarCorner}
                            onChange={(e) =>
                              setAvatarCorner(e.target.value as 'br' | 'bl' | 'tr' | 'tl')
                            }
                            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                          >
                            <option value="br">Inferior direito</option>
                            <option value="bl">Inferior esquerdo</option>
                            <option value="tr">Superior direito</option>
                            <option value="tl">Superior esquerdo</option>
                          </select>
                        </label>
                        <label className="text-[11px] text-muted-foreground">
                          Tamanho: {avatarSizePct}%
                          <input
                            type="range"
                            min={18}
                            max={40}
                            step={2}
                            value={avatarSizePct}
                            onChange={(e) => setAvatarSizePct(Number(e.target.value))}
                            className="mt-1 w-full"
                          />
                        </label>
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Gera 2 vídeos (produto + avatar) e compõe — leva ~1-3 min.
                        Requer o avatar D-ID configurado.
                      </p>
                    </>
                  )}
                </Field>

                {!selectedProduct && (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-600 dark:text-amber-400">
                    Escolha um produto acima — a foto dele é a base do vídeo.
                  </p>
                )}
              </>
            )}

            {tab !== 'video' && (
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
            )}

            <Field label={tab === 'video' ? 'Tema (opcional — a IA usa o produto)' : 'Tema (sobre o que é o post?)'} required={tab !== 'video'}>
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

            {tab !== 'video' && (
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
            )}

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

            <Button
              onClick={tab === 'video' ? generateReel : generate}
              disabled={
                tab === 'video'
                  ? generating || !selectedProduct || pollId !== null
                  : generating || !theme.trim()
              }
            >
              {tab === 'video' ? <Clapperboard className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              <span className="ml-1">
                {tab === 'video'
                  ? generating || pollId !== null
                    ? 'Gerando vídeo…'
                    : 'Gerar Reel'
                  : generating
                    ? `Gerando ${tab === 'carousel' ? 'carrossel' : 'post'}…`
                    : 'Gerar agora'}
              </span>
            </Button>
            {generating && tab !== 'video' && (
              <p className="text-xs text-muted-foreground">
                A IA está pensando, escrevendo e gerando imagens. Pode levar 15-45s.
              </p>
            )}
            {tab === 'video' && (
              <p className="text-xs text-muted-foreground">
                A IA escreve o roteiro e gera o vídeo no motor (Kling). O vídeo é
                assíncrono — pode levar de 1 a 3 minutos. Consome créditos de geração.
              </p>
            )}
          </div>

          {/* Preview */}
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Preview</h2>
            {result ? (
              <>
                {result.content_type === 'reel' ? (
                  reelStatus === 'completed' && result.media?.[0]?.url ? (
                    <div className="mx-auto w-full max-w-[320px]">
                      <video
                        src={result.media[0].url}
                        poster={result.cover_image_url ?? undefined}
                        controls
                        playsInline
                        className="aspect-[9/16] w-full rounded-xl bg-black object-contain"
                      />
                      {result.caption && (
                        <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">
                          {result.caption}
                        </p>
                      )}
                    </div>
                  ) : reelStatus === 'failed' ? (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-center text-sm">
                      <p className="font-medium text-red-700 dark:text-red-300">
                        Falha ao gerar o vídeo
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {(result.metadata as { video_error?: string } | null)?.video_error ??
                          'O motor de vídeo não respondeu. O worker pode estar desligado — tente de novo em instantes.'}
                      </p>
                    </div>
                  ) : (
                    <div className="mx-auto flex aspect-[9/16] w-full max-w-[320px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm font-medium">🎬 Gerando o vídeo…</p>
                      <p className="text-xs text-muted-foreground">
                        Roteiro pronto. O motor está renderizando (1-3 min). Pode deixar a tela aberta.
                      </p>
                    </div>
                  )
                ) : (
                  <InstagramMockup
                    content={result}
                    brand={brands.find((b) => b.id === result.brand_id)}
                  />
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={clearResult}>
                    Limpar
                  </Button>
                  <Button size="sm" onClick={goToDetail}>
                    Ir para detalhe →
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                {tab === 'video'
                  ? 'Escolha o produto e o estilo, e clique em "Gerar Reel"'
                  : generating
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
