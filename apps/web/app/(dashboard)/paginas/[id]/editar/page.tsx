'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  GripVertical,
  Loader2,
  Monitor,
  Palette,
  Plus,
  Save,
  Settings,
  Share2,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AiPageImprovement,
  Page,
  PageBlock,
  StoreProduct,
} from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { pagesApi } from '@/lib/api/pages';
import { ApiError } from '@/lib/api/client';
import { useConfirm, usePrompt } from '@/components/ui/confirm-provider';
import { BLOCK_CATEGORIES, BLOCK_ICONS, BLOCK_LABELS } from '@/components/paginas/block-icons';
import { BlockContentEditor } from '@/components/paginas/block-content-editor';
import { PagePreview } from '@/components/paginas/page-preview';
import { PublishDialog } from '@/components/paginas/publish-dialog';
import { StoreEditor } from '@/components/paginas/store-editor';
import { cn } from '@/lib/utils';

type Tab = 'blocks' | 'settings' | 'seo' | 'store';
type Device = 'desktop' | 'tablet' | 'mobile';

export default function EditPagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) ?? 'blocks';

  const [page, setPage] = useState<Page | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [device, setDevice] = useState<Device>('desktop');
  const [publishOpen, setPublishOpen] = useState(false);
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
  const [highlightBlock, setHighlightBlock] = useState<string | null>(null);
  const [addBlockOpen, setAddBlockOpen] = useState(false);
  const [improvements, setImprovements] = useState<AiPageImprovement[] | null>(null);
  const [loadingImprovements, setLoadingImprovements] = useState(false);
  const confirm = useConfirm();
  const prompt = usePrompt();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reload = useCallback(async () => {
    setError(null);
    try {
      const p = await pagesApi.get(id);
      setPage(p);
      if (p.page_type === 'store') {
        const prods = await pagesApi.listProducts(id).catch(() => []);
        setProducts(prods);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const sortedBlocks = useMemo(
    () => (page ? [...page.blocks].sort((a, b) => a.position - b.position) : []),
    [page],
  );

  function update(patch: Partial<Page>) {
    setPage((curr) => (curr ? { ...curr, ...patch } : curr));
  }

  function updateBlock(blockId: string, contentPatch: Record<string, unknown>) {
    if (!page) return;
    const blocks = page.blocks.map((b) =>
      b.id === blockId ? { ...b, content: { ...b.content, ...contentPatch } } : b,
    );
    update({ blocks });
  }

  function updateBlockSettings(blockId: string, settingsPatch: Partial<PageBlock['settings']>) {
    if (!page) return;
    const blocks = page.blocks.map((b) =>
      b.id === blockId ? { ...b, settings: { ...b.settings, ...settingsPatch } } : b,
    );
    update({ blocks });
  }

  function addBlock(type: PageBlock['type']) {
    if (!page) return;
    const newBlock: PageBlock = {
      id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `block_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type,
      content: defaultContentFor(type),
      settings: { padding: 'md', max_width: 'lg' },
      position: page.blocks.length,
    };
    update({ blocks: [...page.blocks, newBlock] });
    setExpandedBlocks((s) => new Set([...s, newBlock.id]));
    setAddBlockOpen(false);
  }

  function duplicateBlock(blockId: string) {
    if (!page) return;
    const idx = page.blocks.findIndex((b) => b.id === blockId);
    if (idx < 0) return;
    const original = page.blocks[idx];
    if (!original) return;
    const newBlock: PageBlock = {
      ...original,
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `block_${Date.now()}`,
      position: idx + 1,
    };
    const blocks = [
      ...page.blocks.slice(0, idx + 1),
      newBlock,
      ...page.blocks.slice(idx + 1),
    ].map((b, i) => ({ ...b, position: i }));
    update({ blocks });
  }

  async function deleteBlock(blockId: string) {
    if (!page) return;
    const block = page.blocks.find((b) => b.id === blockId);
    const ok = await confirm({
      title: `Remover bloco "${block ? BLOCK_LABELS[block.type] : ''}"?`,
      variant: 'destructive',
      confirmLabel: 'Remover',
      icon: Trash2,
    });
    if (!ok) return;
    const blocks = page.blocks
      .filter((b) => b.id !== blockId)
      .map((b, i) => ({ ...b, position: i }));
    update({ blocks });
  }

  async function rewriteBlock(blockId: string) {
    if (!page) return;
    const instruction = await prompt({
      title: 'Reescrever este bloco com IA',
      description: 'Diga o que mudar (ex: "torne mais persuasivo", "adicione urgência", "encurte o texto").',
      placeholder: 'Torne mais persuasivo e adicione urgência',
      multiline: true,
      confirmLabel: 'Reescrever',
    });
    if (!instruction) return;
    const tid = toast.loading('Reescrevendo com IA...');
    try {
      const updated = await pagesApi.rewriteBlock(page.id, blockId, instruction);
      setPage(updated);
      toast.success('Bloco atualizado', { id: tid });
    } catch (err) {
      toast.error('Falha ao reescrever', {
        id: tid,
        description: err instanceof Error ? err.message : 'erro',
      });
    }
  }

  async function generateBlockAi() {
    if (!page) return;
    const description = await prompt({
      title: 'Gerar bloco com IA',
      description: 'Descreva o que você quer adicionar (ex: "uma seção de FAQ sobre preços e prazos").',
      placeholder: 'Uma seção de depoimentos com 3 clientes...',
      multiline: true,
      confirmLabel: 'Gerar',
    });
    if (!description) return;
    const tid = toast.loading('Gerando bloco...');
    try {
      await pagesApi.generateBlock(page.id, description);
      await reload();
      toast.success('Bloco adicionado', { id: tid });
    } catch (err) {
      toast.error('Falha ao gerar', {
        id: tid,
        description: err instanceof Error ? err.message : 'erro',
      });
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!page || !over || active.id === over.id) return;
    const oldIdx = sortedBlocks.findIndex((b) => b.id === active.id);
    const newIdx = sortedBlocks.findIndex((b) => b.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(sortedBlocks, oldIdx, newIdx).map((b, i) => ({
      ...b,
      position: i,
    }));
    update({ blocks: reordered });
  }

  async function save() {
    if (!page) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await pagesApi.update(page.id, {
        name: page.name,
        slug: page.slug,
        blocks: page.blocks,
        global_styles: page.global_styles,
        seo: page.seo,
        settings: page.settings,
      });
      setPage(updated);
      toast.success('Página salva');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish() {
    if (!page) return;
    try {
      const updated =
        page.status === 'published' ? await pagesApi.unpublish(page.id) : await pagesApi.publish(page.id);
      setPage(updated);
      toast.success(
        page.status === 'published' ? 'Página despublicada' : 'Página publicada com sucesso!',
      );
    } catch (err) {
      toast.error('Falha ao publicar', { description: err instanceof Error ? err.message : 'erro' });
    }
  }

  async function loadImprovements() {
    if (!page) return;
    setLoadingImprovements(true);
    try {
      const list = await pagesApi.suggestImprovements(page.id);
      setImprovements(list);
    } catch (err) {
      toast.error('Falha ao carregar sugestões', {
        description: err instanceof Error ? err.message : 'erro',
      });
    } finally {
      setLoadingImprovements(false);
    }
  }

  function toggleExpand(blockId: string) {
    setExpandedBlocks((s) => {
      const next = new Set(s);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!page) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Página não encontrada.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/paginas')}>
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <Input
            value={page.name}
            onChange={(e) => update({ name: e.target.value })}
            className="h-8 w-72 font-semibold"
          />
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
              page.status === 'published'
                ? 'bg-green-500/15 text-green-500'
                : page.status === 'paused'
                  ? 'bg-yellow-500/15 text-yellow-500'
                  : 'bg-muted text-muted-foreground',
            )}
          >
            {page.status}
          </span>
          {page.ai_generated && (
            <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              <Sparkles className="h-2.5 w-2.5" />
              AI
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
            {(
              [
                { v: 'desktop' as const, icon: Monitor },
                { v: 'tablet' as const, icon: Tablet },
                { v: 'mobile' as const, icon: Smartphone },
              ] as const
            ).map(({ v, icon: Icon }) => (
              <button
                key={v}
                type="button"
                onClick={() => setDevice(v)}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded transition-colors',
                  device === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                )}
                title={v}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={loadImprovements} disabled={loadingImprovements}>
            {loadingImprovements ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Sugestões IA
          </Button>

          <Button variant="outline" size="sm" onClick={togglePublish}>
            <Eye className="h-3.5 w-3.5" />
            {page.status === 'published' ? 'Despublicar' : 'Publicar'}
          </Button>

          {page.status === 'published' && (
            <Button variant="outline" size="sm" onClick={() => setPublishOpen(true)}>
              <Share2 className="h-3.5 w-3.5" />
              Compartilhar
            </Button>
          )}

          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Salvar
          </Button>
        </div>
      </header>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {improvements && improvements.length > 0 && (
        <div className="border-b border-primary/20 bg-primary/5 px-6 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Sugestões da IA
            </span>
            <button
              type="button"
              onClick={() => setImprovements(null)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              fechar
            </button>
          </div>
          <ul className="space-y-1.5">
            {improvements.map((imp, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span
                  className={cn(
                    'mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full',
                    imp.severity === 'critical'
                      ? 'bg-red-500'
                      : imp.severity === 'warning'
                        ? 'bg-yellow-500'
                        : 'bg-cyan-500',
                  )}
                />
                <div>
                  <strong>{imp.title}</strong>
                  <span className="text-muted-foreground"> — {imp.description}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[400px_1fr]">
        {/* Editor (esquerda) */}
        <div className="flex flex-col overflow-hidden border-r border-border">
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as Tab)}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <TabsList className="px-3">
              <TabsTrigger value="blocks">
                <span className="text-[11px]">Blocos</span>
              </TabsTrigger>
              <TabsTrigger value="settings">
                <Settings className="h-3 w-3" />
                <span className="text-[11px]">Config</span>
              </TabsTrigger>
              <TabsTrigger value="seo">
                <span className="text-[11px]">SEO</span>
              </TabsTrigger>
              {page.page_type === 'store' && (
                <TabsTrigger value="store">
                  <ShoppingBag className="h-3 w-3" />
                  <span className="text-[11px]">Loja</span>
                </TabsTrigger>
              )}
            </TabsList>

            {/* BLOCOS */}
            <TabsContent value="blocks" className="overflow-y-auto p-3 scrollbar-thin">
              <div className="mb-3 flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => setAddBlockOpen((o) => !o)}>
                  <Plus className="h-3.5 w-3.5" />
                  Bloco
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 bg-gradient-to-r from-cyan-500/10 to-blue-500/10"
                  onClick={generateBlockAi}
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Gerar IA
                </Button>
              </div>

              {addBlockOpen && (
                <div className="mb-3 rounded-md border border-border bg-background p-2">
                  {BLOCK_CATEGORIES.map((cat) => (
                    <div key={cat.name} className="mb-2 last:mb-0">
                      <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {cat.icon} {cat.name}
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {cat.types.map((t) => {
                          const Icon = BLOCK_ICONS[t];
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => addBlock(t)}
                              className="flex flex-col items-center gap-1 rounded-md p-2 text-[10px] hover:bg-muted"
                            >
                              <Icon className="h-3.5 w-3.5" />
                              <span className="truncate w-full text-center">{BLOCK_LABELS[t]}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {sortedBlocks.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  Nenhum bloco. Clique em &ldquo;+ Bloco&rdquo; ou &ldquo;Gerar IA&rdquo; pra começar.
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext
                    items={sortedBlocks.map((b) => b.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-1.5">
                      {sortedBlocks.map((b) => (
                        <BlockListItem
                          key={b.id}
                          block={b}
                          expanded={expandedBlocks.has(b.id)}
                          onToggle={() => toggleExpand(b.id)}
                          onClick={() => setHighlightBlock(b.id)}
                          onContentChange={(content) =>
                            updateBlock(b.id, content as Record<string, unknown>)
                          }
                          onSettingsChange={(s) => updateBlockSettings(b.id, s)}
                          onRewrite={() => rewriteBlock(b.id)}
                          onDuplicate={() => duplicateBlock(b.id)}
                          onDelete={() => deleteBlock(b.id)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </TabsContent>

            {/* SETTINGS */}
            <TabsContent value="settings" className="overflow-y-auto p-4 scrollbar-thin">
              <SettingsPanel page={page} onChange={(patch) => update(patch)} />
            </TabsContent>

            {/* SEO */}
            <TabsContent value="seo" className="overflow-y-auto p-4 scrollbar-thin">
              <SeoPanel page={page} onChange={(seo) => update({ seo })} />
            </TabsContent>

            {/* STORE */}
            {page.page_type === 'store' && (
              <TabsContent value="store" className="overflow-y-auto p-4 scrollbar-thin">
                <StoreEditor
                  pageId={page.id}
                  products={products}
                  onProductsChange={setProducts}
                  storeSettings={page.settings.store ?? {}}
                  onStoreSettingsChange={(store) =>
                    update({ settings: { ...page.settings, store } })
                  }
                />
              </TabsContent>
            )}
          </Tabs>
        </div>

        {/* Preview (direita) */}
        <div className="overflow-hidden bg-muted/40">
          <PagePreview
            page={page}
            products={products}
            device={device}
            highlightBlockId={highlightBlock}
          />
        </div>
      </div>

      {publishOpen && (
        <PublishDialog page={page} open={publishOpen} onOpenChange={setPublishOpen} />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Block list item
// ────────────────────────────────────────────────────────────

function BlockListItem({
  block,
  expanded,
  onToggle,
  onClick,
  onContentChange,
  onSettingsChange,
  onRewrite,
  onDuplicate,
  onDelete,
}: {
  block: PageBlock;
  expanded: boolean;
  onToggle: () => void;
  onClick: () => void;
  onContentChange: (content: Record<string, unknown>) => void;
  onSettingsChange: (settings: Partial<PageBlock['settings']>) => void;
  onRewrite: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });
  const Icon = BLOCK_ICONS[block.type];
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-md border border-border bg-card transition-colors',
        isDragging && 'shadow-lg',
      )}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted-foreground active:cursor-grabbing"
          aria-label="Arrastar"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            onToggle();
            onClick();
          }}
          className="flex flex-1 items-center gap-1.5 text-left text-xs"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
          <Icon className="h-3.5 w-3.5 text-primary" />
          <span className="font-medium">{BLOCK_LABELS[block.type]}</span>
        </button>
        <button
          type="button"
          onClick={onRewrite}
          className="rounded p-1 text-primary hover:bg-primary/10"
          title="Reescrever com IA"
        >
          <Sparkles className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          title="Duplicar"
        >
          <Copy className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-destructive hover:bg-destructive/10"
          title="Remover"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border p-3">
          <BlockContentEditor block={block} onChange={onContentChange} />
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Padding</Label>
              <select
                value={block.settings.padding ?? 'md'}
                onChange={(e) =>
                  onSettingsChange({ padding: e.target.value as PageBlock['settings']['padding'] })
                }
                className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs"
              >
                <option value="sm">Pequeno</option>
                <option value="md">Médio</option>
                <option value="lg">Grande</option>
                <option value="xl">Extra grande</option>
              </select>
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Largura</Label>
              <select
                value={block.settings.max_width ?? 'lg'}
                onChange={(e) =>
                  onSettingsChange({ max_width: e.target.value as PageBlock['settings']['max_width'] })
                }
                className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs"
              >
                <option value="sm">Estreita</option>
                <option value="md">Média</option>
                <option value="lg">Larga</option>
                <option value="full">Tela cheia</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Settings panel
// ────────────────────────────────────────────────────────────

function SettingsPanel({
  page,
  onChange,
}: {
  page: Page;
  onChange: (patch: Partial<Page>) => void;
}) {
  function setStyle<K extends keyof Page['global_styles']>(key: K, value: Page['global_styles'][K]) {
    onChange({ global_styles: { ...page.global_styles, [key]: value } });
  }
  function setSettings(patch: Partial<Page['settings']>) {
    onChange({ settings: { ...page.settings, ...patch } });
  }

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-sm font-semibold">Identidade</h3>
        <div className="space-y-2">
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Slug (URL)</Label>
            <div className="flex items-center gap-1 text-sm">
              <span className="text-muted-foreground">/p/</span>
              <Input
                value={page.slug}
                onChange={(e) =>
                  onChange({
                    slug: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, '-')
                      .replace(/-+/g, '-'),
                  })
                }
                className="h-8"
              />
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold flex items-center gap-1.5">
          <Palette className="h-3.5 w-3.5" />
          Visual
        </h3>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Cor primária</Label>
              <ColorInput
                value={page.global_styles.primary_color ?? '#00E5FF'}
                onChange={(v) => setStyle('primary_color', v)}
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Cor secundária</Label>
              <ColorInput
                value={page.global_styles.secondary_color ?? '#0EA5E9'}
                onChange={(v) => setStyle('secondary_color', v)}
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Background</Label>
              <ColorInput
                value={page.global_styles.background ?? '#0A0A0F'}
                onChange={(v) => setStyle('background', v)}
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Texto</Label>
              <ColorInput
                value={page.global_styles.text_color ?? '#F5F5F7'}
                onChange={(v) => setStyle('text_color', v)}
              />
            </div>
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Fonte heading</Label>
            <select
              value={page.global_styles.font_heading ?? ''}
              onChange={(e) => setStyle('font_heading', e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">System</option>
              <option value="Inter">Inter</option>
              <option value="Poppins">Poppins</option>
              <option value="Roboto">Roboto</option>
              <option value="Montserrat">Montserrat</option>
              <option value="Playfair Display">Playfair Display</option>
              <option value="Bebas Neue">Bebas Neue</option>
              <option value="Oswald">Oswald</option>
              <option value="DM Sans">DM Sans</option>
              <option value="Manrope">Manrope</option>
              <option value="Outfit">Outfit</option>
            </select>
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Fonte corpo</Label>
            <select
              value={page.global_styles.font_body ?? ''}
              onChange={(e) => setStyle('font_body', e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">System</option>
              <option value="Inter">Inter</option>
              <option value="Poppins">Poppins</option>
              <option value="Roboto">Roboto</option>
              <option value="DM Sans">DM Sans</option>
              <option value="Manrope">Manrope</option>
              <option value="Outfit">Outfit</option>
            </select>
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">
              Border radius (px) — {page.global_styles.border_radius ?? 8}
            </Label>
            <input
              type="range"
              min={0}
              max={24}
              value={page.global_styles.border_radius ?? 8}
              onChange={(e) => setStyle('border_radius', Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">WhatsApp flutuante</h3>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={page.settings.whatsapp_floating?.enabled ?? false}
            onChange={(e) =>
              setSettings({
                whatsapp_floating: {
                  ...(page.settings.whatsapp_floating ?? {}),
                  enabled: e.target.checked,
                },
              })
            }
          />
          Mostrar botão WhatsApp fixo
        </label>
        {page.settings.whatsapp_floating?.enabled && (
          <div className="mt-2 space-y-2">
            <Input
              placeholder="Telefone"
              value={page.settings.whatsapp_floating?.phone ?? ''}
              onChange={(e) =>
                setSettings({
                  whatsapp_floating: {
                    ...(page.settings.whatsapp_floating ?? { enabled: true }),
                    phone: e.target.value,
                  },
                })
              }
              className="h-8"
            />
            <textarea
              placeholder="Mensagem pré-definida"
              value={page.settings.whatsapp_floating?.message ?? ''}
              onChange={(e) =>
                setSettings({
                  whatsapp_floating: {
                    ...(page.settings.whatsapp_floating ?? { enabled: true }),
                    message: e.target.value,
                  },
                })
              }
              rows={2}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Tracking</h3>
        <div className="space-y-2">
          <Input
            placeholder="Google Analytics ID (G-XXXX)"
            value={page.settings.tracking_scripts?.google_analytics_id ?? ''}
            onChange={(e) =>
              setSettings({
                tracking_scripts: {
                  ...(page.settings.tracking_scripts ?? {}),
                  google_analytics_id: e.target.value,
                },
              })
            }
            className="h-8"
          />
          <Input
            placeholder="Facebook Pixel ID"
            value={page.settings.tracking_scripts?.facebook_pixel_id ?? ''}
            onChange={(e) =>
              setSettings({
                tracking_scripts: {
                  ...(page.settings.tracking_scripts ?? {}),
                  facebook_pixel_id: e.target.value,
                },
              })
            }
            className="h-8"
          />
          <Input
            placeholder="TikTok Pixel ID"
            value={page.settings.tracking_scripts?.tiktok_pixel_id ?? ''}
            onChange={(e) =>
              setSettings({
                tracking_scripts: {
                  ...(page.settings.tracking_scripts ?? {}),
                  tiktok_pixel_id: e.target.value,
                },
              })
            }
            className="h-8"
          />
        </div>
      </section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// SEO panel
// ────────────────────────────────────────────────────────────

function SeoPanel({
  page,
  onChange,
}: {
  page: Page;
  onChange: (seo: Page['seo']) => void;
}) {
  function set<K extends keyof Page['seo']>(key: K, value: Page['seo'][K]) {
    onChange({ ...page.seo, [key]: value });
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">
          Title ({(page.seo.title ?? '').length}/60)
        </Label>
        <Input
          value={page.seo.title ?? ''}
          onChange={(e) => set('title', e.target.value.slice(0, 80))}
          placeholder="Título que aparece na aba do navegador e Google"
          className="h-8"
        />
      </div>
      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">
          Description ({(page.seo.description ?? '').length}/160)
        </Label>
        <textarea
          value={page.seo.description ?? ''}
          onChange={(e) => set('description', e.target.value.slice(0, 200))}
          rows={3}
          placeholder="Resumo de 1-2 frases pra Google e compartilhamento"
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
      </div>
      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">OG Title (compartilhamento)</Label>
        <Input
          value={page.seo.og_title ?? ''}
          onChange={(e) => set('og_title', e.target.value)}
          className="h-8"
        />
      </div>
      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">OG Description</Label>
        <textarea
          value={page.seo.og_description ?? ''}
          onChange={(e) => set('og_description', e.target.value)}
          rows={2}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
      </div>
      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">OG Image (URL)</Label>
        <Input
          value={page.seo.og_image ?? ''}
          onChange={(e) => set('og_image', e.target.value)}
          placeholder="https://..."
          className="h-8"
        />
      </div>
      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">Favicon</Label>
        <Input
          value={page.seo.favicon ?? ''}
          onChange={(e) => set('favicon', e.target.value)}
          placeholder="https://..."
          className="h-8"
        />
      </div>
      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">Robots</Label>
        <select
          value={page.seo.robots ?? 'index, follow'}
          onChange={(e) => set('robots', e.target.value as Page['seo']['robots'])}
          className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="index, follow">Indexar (recomendado)</option>
          <option value="noindex">No-index</option>
          <option value="noindex, nofollow">No-index + No-follow</option>
        </select>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Color input
// ────────────────────────────────────────────────────────────

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 cursor-pointer rounded-md border border-border bg-background"
      />
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 flex-1 font-mono text-xs" />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Default content por tipo de bloco
// ────────────────────────────────────────────────────────────

function defaultContentFor(type: PageBlock['type']): Record<string, unknown> {
  const map: Partial<Record<PageBlock['type'], Record<string, unknown>>> = {
    hero: {
      headline: 'Título principal',
      subheadline: 'Subtítulo persuasivo aqui',
      cta_text: 'Saiba mais',
      cta_href: '#',
      layout: 'centered',
    },
    heading: { title: 'Título da seção', subtitle: '' },
    text: { text: 'Escreva aqui...', align: 'left' },
    benefits: {
      title: 'Por que escolher',
      items: [
        { icon: '✨', title: 'Benefício 1', description: 'Descrição curta' },
        { icon: '🚀', title: 'Benefício 2', description: 'Descrição curta' },
        { icon: '💎', title: 'Benefício 3', description: 'Descrição curta' },
      ],
    },
    testimonials: {
      title: 'O que nossos clientes dizem',
      items: [{ name: 'Cliente', text: 'Depoimento...', stars: 5 }],
    },
    faq: {
      title: 'Perguntas frequentes',
      items: [{ question: 'Pergunta?', answer: 'Resposta.' }],
    },
    cta: { title: 'Pronto pra começar?', subtitle: '', button_text: 'Começar agora', button_href: '#' },
    stats: { items: [{ number: '500', label: 'Clientes', suffix: '+' }] },
    features: { title: 'Features', items: ['Item 1', 'Item 2'] },
    navbar: {
      logo_text: 'Marca',
      links: [
        { label: 'Início', href: '#' },
        { label: 'Contato', href: '#contato' },
      ],
    },
    footer: {
      logo: 'Marca',
      copyright: `© ${new Date().getFullYear()} Todos os direitos reservados.`,
      links: [],
      social: [],
    },
    spacer: { height: 40 },
    divider: {},
    whatsapp_button: { text: 'Falar no WhatsApp', message: 'Olá!', phone: '' },
    floating_cta: { type: 'whatsapp', phone: '', message: 'Olá!' },
    product_grid: { title: 'Produtos', columns: 3 },
    pricing_table: {
      title: 'Planos',
      plans: [{ name: 'Plano', price: 'R$ 0', features: ['Feature 1'] }],
    },
  };
  return map[type] ?? {};
}
