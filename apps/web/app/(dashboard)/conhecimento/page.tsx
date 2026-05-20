'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BookOpen,
  ExternalLink,
  FileText,
  FileUp,
  Globe,
  Link as LinkIcon,
  PlayCircle,
  Package,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  KnowledgeCategory,
  KnowledgeLiveSource,
  ProductCatalogItem,
} from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  knowledgeApi,
  type KnowledgeDocumentListItem,
} from '@/lib/api/knowledge';
import { ApiError } from '@/lib/api/client';
import {
  CategoryBadge,
  KNOWLEDGE_CATEGORIES,
  useCategoryLabel,
} from '@/components/conhecimento/category-badge';
import { NewDocumentDialog } from '@/components/conhecimento/new-document-dialog';
import { ImportUrlDialog } from '@/components/conhecimento/import-url-dialog';
import { ImportUrlBatchDialog } from '@/components/conhecimento/import-url-batch-dialog';
import {
  UploadFileDialog,
  FileTypeIcon,
  fileTypeLabel,
} from '@/components/conhecimento/upload-file-dialog';
import { NewLiveSourceDialog } from '@/components/conhecimento/new-live-source-dialog';
import { EditLiveSourceSheet } from '@/components/conhecimento/edit-live-source-sheet';
import { EditDocumentSheet } from '@/components/conhecimento/edit-document-sheet';
import { ProductSheet } from '@/components/conhecimento/product-sheet';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tab = 'docs' | 'products' | 'live';

export default function ConhecimentoPage() {
  const t = useTranslations('conhecimento.page');
  const [tab, setTab] = useState<Tab>('docs');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-semibold">{t('title')}</h1>
          </div>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <TabButton active={tab === 'docs'} onClick={() => setTab('docs')} icon={FileText}>
            {t('tabs.documents')}
          </TabButton>
          <TabButton active={tab === 'live'} onClick={() => setTab('live')} icon={Globe}>
            {t('tabs.live')}
          </TabButton>
          <TabButton active={tab === 'products'} onClick={() => setTab('products')} icon={Package}>
            {t('tabs.catalog')}
          </TabButton>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
          {tab === 'docs' ? <DocumentsTab /> : tab === 'live' ? <LiveSourcesTab /> : <ProductsTab />}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Tab button
// ──────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────────────────
// DOCUMENTS TAB
// ──────────────────────────────────────────────────────────

function DocumentsTab() {
  const t = useTranslations('conhecimento.docs');
  const categoryLabel = useCategoryLabel();
  const [docs, setDocs] = useState<KnowledgeDocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<KnowledgeCategory | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'manual' | 'url' | 'file' | 'integration' | 'auto'>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [importUrlOpen, setImportUrlOpen] = useState(false);
  const [importBatchOpen, setImportBatchOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeDocumentListItem | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const result = await knowledgeApi.list({
        category: categoryFilter === 'all' ? undefined : categoryFilter,
        search: search.trim() || undefined,
      });
      setDocs(result.data);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : t('loadError'),
      );
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, search, t]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    if (sourceFilter === 'all') return docs;
    return docs.filter((d) => d.source_type === sourceFilter);
  }, [docs, sourceFilter]);

  async function toggleActive(doc: KnowledgeDocumentListItem) {
    setDocs((curr) =>
      curr.map((d) => (d.id === doc.id ? { ...d, is_active: !d.is_active } : d)),
    );
    try {
      await knowledgeApi.update(doc.id, { is_active: !doc.is_active });
    } catch {
      // Reverte
      setDocs((curr) =>
        curr.map((d) => (d.id === doc.id ? { ...d, is_active: doc.is_active } : d)),
      );
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="h-9 max-w-xs"
        />

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as KnowledgeCategory | 'all')}
          className={cn(
            'h-9 rounded-md border border-input bg-background px-3 text-xs',
            'focus:outline-none focus:ring-2 focus:ring-ring',
          )}
        >
          <option value="all">{t('allCategories')}</option>
          {KNOWLEDGE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>

        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
          className={cn(
            'h-9 rounded-md border border-input bg-background px-3 text-xs',
            'focus:outline-none focus:ring-2 focus:ring-ring',
          )}
        >
          <option value="all">{t('allSources')}</option>
          <option value="manual">{t('sources.manual')}</option>
          <option value="url">{t('sources.url')}</option>
          <option value="file">{t('sources.file')}</option>
          <option value="integration">{t('sources.integration')}</option>
          <option value="auto">{t('sources.auto')}</option>
        </select>

        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
            <FileUp className="mr-2 h-3.5 w-3.5" />
            {t('uploadFile')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportBatchOpen(true)}>
            <LinkIcon className="mr-2 h-3.5 w-3.5" />
            {t('multipleUrls')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportUrlOpen(true)}>
            <LinkIcon className="mr-2 h-3.5 w-3.5" />
            {t('importFromUrl')}
          </Button>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            {t('newDocument')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && docs.length === 0 ? (
        <DocsSkeleton />
      ) : filtered.length === 0 ? (
        <DocsEmpty onCreate={() => setNewOpen(true)} />
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((d, i) => (
            <li
              key={d.id}
              className="animate-in fade-in slide-in-from-bottom-1"
              style={{ animationDelay: `${i * 25}ms`, animationFillMode: 'backwards' }}
            >
              <DocRow
                doc={d}
                onSelect={() => setEditing(d)}
                onToggleActive={() => void toggleActive(d)}
                onRefreshed={() => void reload()}
              />
            </li>
          ))}
        </ul>
      )}

      <NewDocumentDialog open={newOpen} onOpenChange={setNewOpen} onCreated={() => void reload()} />
      <ImportUrlDialog
        open={importUrlOpen}
        onOpenChange={setImportUrlOpen}
        onImported={() => void reload()}
      />
      <ImportUrlBatchDialog
        open={importBatchOpen}
        onOpenChange={setImportBatchOpen}
        onImported={() => void reload()}
      />
      <UploadFileDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onImported={() => void reload()}
      />
      <EditDocumentSheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        document={editing}
        onChanged={() => void reload()}
      />
    </>
  );
}

function DocRow({
  doc,
  onSelect,
  onToggleActive,
  onRefreshed,
}: {
  doc: KnowledgeDocumentListItem;
  onSelect: () => void;
  onToggleActive: () => void;
  onRefreshed: () => void;
}) {
  const t = useTranslations('conhecimento.docs');
  const [refreshing, setRefreshing] = useState(false);
  const isUrlDoc = doc.source_type === 'url' && doc.source_url;
  const isFileDoc = doc.source_type === 'file';
  const fileMeta = isFileDoc ? (doc.metadata as Record<string, unknown>) : null;
  const fileType = (fileMeta?.file_type as string) ?? null;
  const originalFilename = (fileMeta?.original_filename as string) ?? null;
  const fileSize = typeof fileMeta?.file_size === 'number' ? (fileMeta.file_size as number) : null;
  const pagesCount = typeof fileMeta?.pages_count === 'number' ? (fileMeta.pages_count as number) : null;
  const chunkIndex = typeof fileMeta?.chunk_index === 'number' ? (fileMeta.chunk_index as number) : null;
  const chunkTotal = typeof fileMeta?.chunk_total === 'number' ? (fileMeta.chunk_total as number) : null;
  const isChunkPart = chunkIndex !== null && chunkTotal !== null && chunkTotal > 1;

  async function handleRefresh(e: React.MouseEvent) {
    e.stopPropagation();
    setRefreshing(true);
    try {
      const r = await knowledgeApi.refreshUrlDocument(doc.id);
      if (r.updated) {
        toast.success(t('updatedTitle'), { description: t('updatedDesc') });
      } else {
        toast.info(t('noChangesTitle'), { description: t('noChangesDesc') });
      }
      onRefreshed();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : t('error');
      toast.error(t('refreshFailed'), { description: msg });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect();
      }}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card p-4 transition-all',
        'hover:border-primary/30 hover:shadow-sm',
        !doc.is_active && 'opacity-60',
        isChunkPart && 'ml-6 border-l-2 border-l-primary/20',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{doc.title}</span>
          <CategoryBadge category={doc.category} />
          {isUrlDoc && (
            <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
              <LinkIcon className="h-2.5 w-2.5" /> URL
            </span>
          )}
          {isFileDoc && fileType && (
            <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
              <FileTypeIcon filename={originalFilename ?? `.${fileType}`} className="h-2.5 w-2.5" />
              {fileTypeLabel(fileType as 'pdf' | 'excel' | 'csv' | 'word' | 'text')}
            </span>
          )}
        </div>
        {isUrlDoc && doc.source_url && (
          <a
            href={doc.source_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 truncate text-[11px] text-muted-foreground hover:text-foreground hover:underline"
          >
            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
            {doc.source_url}
          </a>
        )}
        {isFileDoc && originalFilename && (
          <span className="truncate text-[11px] text-muted-foreground">
            {originalFilename}
            {fileSize !== null && ` · ${(fileSize / 1024).toFixed(0)} KB`}
            {pagesCount !== null && ` · ${t('pages', { n: pagesCount })}`}
          </span>
        )}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{doc.tokens?.toLocaleString('pt-BR') ?? '~'} {t('tokensWord')}</span>
          <span>·</span>
          <span>{t('updatedAt', { when: formatRelativeTime(doc.updated_at) })}</span>
          {isUrlDoc && doc.last_synced_at && (
            <>
              <span>·</span>
              <span>{t('syncAt', { when: formatRelativeTime(doc.last_synced_at) })}</span>
            </>
          )}
          {isChunkPart && (
            <>
              <span>·</span>
              <span>{t('part', { i: chunkIndex, n: chunkTotal })}</span>
            </>
          )}
        </div>
      </div>

      {isUrlDoc && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="shrink-0"
          title={t('refetchUrl')}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>
      )}

      <label
        className="flex shrink-0 items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[11px] text-muted-foreground">
          {doc.is_active ? t('active') : t('inactive')}
        </span>
        <input
          type="checkbox"
          checked={doc.is_active}
          onChange={onToggleActive}
          className="h-4 w-4 cursor-pointer rounded border-input"
        />
      </label>
    </div>
  );
}

function DocsEmpty({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('conhecimento.docs');
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <FileText className="h-6 w-6" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t('emptyTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('emptySubtitle')}</p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <Plus className="mr-2 h-3.5 w-3.5" />
        {t('createFirst')}
      </Button>
    </div>
  );
}

function DocsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// LIVE SOURCES TAB (Feature B)
// ──────────────────────────────────────────────────────────

function LiveSourcesTab() {
  const t = useTranslations('conhecimento.live');
  const [sources, setSources] = useState<KnowledgeLiveSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<KnowledgeLiveSource | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const data = await knowledgeApi.listLiveSources();
      setSources(data);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : t('loadError'),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  async function toggleActive(s: KnowledgeLiveSource) {
    setSources((curr) =>
      curr.map((x) => (x.id === s.id ? { ...x, is_active: !x.is_active } : x)),
    );
    try {
      await knowledgeApi.updateLiveSource(s.id, { is_active: !s.is_active });
    } catch {
      setSources((curr) =>
        curr.map((x) => (x.id === s.id ? { ...x, is_active: s.is_active } : x)),
      );
    }
  }

  async function handleTest(s: KnowledgeLiveSource) {
    setTestingId(s.id);
    try {
      const r = await knowledgeApi.testLiveSource(s.id);
      if (r.ok) {
        toast.success(t('respondingTitle', { name: s.name }), {
          description: t('charsExtracted', {
            n: r.char_count?.toLocaleString('pt-BR') ?? '?',
          }),
        });
        void reload();
      } else {
        toast.error(t('problemTitle', { name: s.name }), { description: r.error });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : t('error');
      toast.error(t('testFailed'), { description: msg });
    } finally {
      setTestingId(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </Button>
        <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          {t('newLiveSource')}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
        {t.rich('description', {
          strong: (chunks) => <strong className="text-foreground">{chunks}</strong>,
        })}
      </div>

      {loading && sources.length === 0 ? (
        <DocsSkeleton />
      ) : sources.length === 0 ? (
        <LiveSourcesEmpty onCreate={() => setCreating(true)} />
      ) : (
        <ul className="flex flex-col gap-2">
          {sources.map((s, i) => (
            <li
              key={s.id}
              className="animate-in fade-in slide-in-from-bottom-1"
              style={{ animationDelay: `${i * 25}ms`, animationFillMode: 'backwards' }}
            >
              <LiveSourceRow
                source={s}
                testing={testingId === s.id}
                onSelect={() => setEditing(s)}
                onToggleActive={() => void toggleActive(s)}
                onTest={() => void handleTest(s)}
              />
            </li>
          ))}
        </ul>
      )}

      <NewLiveSourceDialog open={creating} onOpenChange={setCreating} onCreated={() => void reload()} />
      <EditLiveSourceSheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        source={editing}
        onChanged={() => void reload()}
      />
    </>
  );
}

function LiveSourceRow({
  source,
  testing,
  onSelect,
  onToggleActive,
  onTest,
}: {
  source: KnowledgeLiveSource;
  testing: boolean;
  onSelect: () => void;
  onToggleActive: () => void;
  onTest: () => void;
}) {
  const t = useTranslations('conhecimento.live');
  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect();
      }}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card p-4 transition-all',
        'hover:border-primary/30 hover:shadow-sm',
        !source.is_active && 'opacity-60',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-primary" />
          <span className="truncate text-sm font-medium">{source.name}</span>
          <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
            {source.source_type === 'webpage' ? t('typeWeb') : source.source_type === 'api_endpoint' ? t('typeApi') : t('typeRss')}
          </span>
        </div>
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 truncate text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
          {source.url}
        </a>
        {source.description && (
          <span className="line-clamp-1 text-[11px] text-muted-foreground">{source.description}</span>
        )}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{t('cacheLabel', { min: source.cache_ttl_minutes })}</span>
          <span>·</span>
          <span>
            {source.last_fetched_at
              ? t('lastQuery', { when: formatRelativeTime(source.last_fetched_at) })
              : t('neverQueried')}
          </span>
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          onTest();
        }}
        disabled={testing}
        className="shrink-0"
        title={t('testConnection')}
      >
        <PlayCircle className={cn('h-3.5 w-3.5', testing && 'animate-pulse')} />
      </Button>

      <label className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <span className="text-[11px] text-muted-foreground">{source.is_active ? t('active') : t('inactive')}</span>
        <input
          type="checkbox"
          checked={source.is_active}
          onChange={onToggleActive}
          className="h-4 w-4 cursor-pointer rounded border-input"
        />
      </label>
    </div>
  );
}

function LiveSourcesEmpty({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('conhecimento.live');
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Globe className="h-6 w-6" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t('emptyTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('emptySubtitle')}</p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <Plus className="mr-2 h-3.5 w-3.5" />
        {t('createFirst')}
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// PRODUCTS TAB
// ──────────────────────────────────────────────────────────

function ProductsTab() {
  const t = useTranslations('conhecimento.products');
  const [products, setProducts] = useState<ProductCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ProductCatalogItem | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const result = await knowledgeApi.listProducts({
        search: search.trim() || undefined,
      });
      setProducts(result.data);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : t('loadError'),
      );
    } finally {
      setLoading(false);
    }
  }, [search, t]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="h-9 max-w-xs"
        />

        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </Button>

        <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          {t('newProduct')}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && products.length === 0 ? (
        <ProductsSkeleton />
      ) : products.length === 0 ? (
        <ProductsEmpty onCreate={() => setCreating(true)} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p, i) => (
            <li
              key={p.id}
              className="animate-in fade-in slide-in-from-bottom-1"
              style={{ animationDelay: `${i * 25}ms`, animationFillMode: 'backwards' }}
            >
              <ProductCard product={p} onSelect={() => setEditing(p)} />
            </li>
          ))}
        </ul>
      )}

      <ProductSheet
        open={creating || editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
        product={editing}
        onChanged={() => void reload()}
      />
    </>
  );
}

function ProductCard({
  product,
  onSelect,
}: {
  product: ProductCatalogItem;
  onSelect: () => void;
}) {
  const t = useTranslations('conhecimento.products');
  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect();
      }}
      className={cn(
        'flex cursor-pointer flex-col gap-2 overflow-hidden rounded-xl border border-border bg-card transition-all',
        'hover:border-primary/30 hover:shadow-md',
        !product.is_active && 'opacity-60',
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {product.images.length > 0 && product.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.images[0]}
            alt={product.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/50">
            <Package className="h-10 w-10 text-muted-foreground/50" />
          </div>
        )}
        {!product.is_active && (
          <span className="absolute right-2 top-2 rounded-md bg-background/80 px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm">
            {t('inactive')}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1 p-4 pt-0">
        <span className="truncate text-sm font-semibold">{product.name}</span>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">
            {product.sku ? t('skuPrefix', { sku: product.sku }) : t('noSku')}
            {product.category && ` · ${product.category}`}
          </span>
          {product.price !== null && (
            <span className="shrink-0 text-sm font-semibold tabular-nums text-accent">
              {product.price.toLocaleString('pt-BR', {
                style: 'currency',
                currency: product.currency || 'BRL',
                maximumFractionDigits: 2,
              })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ProductsEmpty({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('conhecimento.products');
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Package className="h-6 w-6" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t('emptyTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('emptySubtitle')}</p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <Plus className="mr-2 h-3.5 w-3.5" />
        {t('createFirst')}
      </Button>
    </div>
  );
}

function ProductsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-56 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}
