'use client';

import { useState } from 'react';
import { CheckCircle2, Link as LinkIcon, Loader2, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import type { KnowledgeCategory } from '@eclick-active/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { knowledgeApi, type UrlBatchPreview } from '@/lib/api/knowledge';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const CATEGORIES: Array<{ value: KnowledgeCategory; label: string }> = [
  { value: 'products', label: 'Produtos' },
  { value: 'pricing', label: 'Preços' },
  { value: 'policies', label: 'Políticas' },
  { value: 'faq', label: 'FAQ' },
  { value: 'scripts', label: 'Scripts' },
  { value: 'objections', label: 'Objeções' },
  { value: 'procedures', label: 'Procedimentos' },
  { value: 'general', label: 'Geral' },
];

interface ImportUrlBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportUrlBatchDialog({ open, onOpenChange, onImported }: ImportUrlBatchDialogProps) {
  const [urlsInput, setUrlsInput] = useState('');
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previews, setPreviews] = useState<UrlBatchPreview[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<KnowledgeCategory>('general');

  function reset() {
    setUrlsInput('');
    setPreviews(null);
    setSelected(new Set());
    setCategory('general');
  }

  function parseUrls(): string[] {
    return urlsInput
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20); // Backend limita 20
  }

  async function handleFetchAll() {
    const urls = parseUrls();
    if (urls.length === 0) {
      toast.error('Cole pelo menos uma URL');
      return;
    }
    if (urls.length > 20) {
      toast.error('Máximo 20 URLs por vez');
      return;
    }
    setFetching(true);
    try {
      const r = await knowledgeApi.batchPreviewUrls(urls, category);
      setPreviews(r);
      // Pré-seleciona todas que deram OK
      setSelected(new Set(r.filter((p) => p.ok).map((p) => p.url)));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro';
      toast.error('Falha ao buscar URLs', { description: msg });
    } finally {
      setFetching(false);
    }
  }

  function toggleSelect(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function handleImportSelected() {
    if (!previews) return;
    const items = previews
      .filter((p) => p.ok && selected.has(p.url) && p.title && p.content)
      .map((p) => ({ url: p.url, title: p.title!, content: p.content! }));
    if (items.length === 0) {
      toast.error('Nenhum item selecionado');
      return;
    }
    setSaving(true);
    try {
      const saved = await knowledgeApi.batchConfirmUrls({ items, category });
      toast.success(`${saved.length} documentos importados`, {
        description: `Categoria: ${CATEGORIES.find((c) => c.value === category)?.label ?? category}`,
      });
      reset();
      onImported();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro';
      toast.error('Falha ao salvar', { description: msg });
    } finally {
      setSaving(false);
    }
  }

  function handleClose(o: boolean) {
    if (!o && !saving && !fetching) reset();
    onOpenChange(o);
  }

  const okCount = previews?.filter((p) => p.ok).length ?? 0;
  const failCount = previews?.filter((p) => !p.ok).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-primary" />
            Importar múltiplas URLs
          </DialogTitle>
          <DialogDescription>
            Cole até 20 URLs (uma por linha). A IA extrai o conteúdo de cada uma e você seleciona quais quer salvar.
          </DialogDescription>
        </DialogHeader>

        {!previews && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>URLs (uma por linha)</Label>
              <Textarea
                value={urlsInput}
                onChange={(e) => setUrlsInput(e.target.value)}
                placeholder={'https://seusite.com/produto-1\nhttps://seusite.com/produto-2\nhttps://seusite.com/faq'}
                rows={8}
                className="font-mono text-xs"
                disabled={fetching}
              />
              <span className="text-[11px] text-muted-foreground">
                {parseUrls().length} URL(s) detectadas
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Categoria (todas)</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as KnowledgeCategory)}
                className={cn(
                  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {previews && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">
                {okCount} sucesso · {failCount} falha · {selected.size} selecionado(s)
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPreviews(null)}>
                Voltar e editar URLs
              </Button>
            </div>
            <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto rounded-md border border-border bg-card p-2">
              {previews.map((p) => (
                <li key={p.url}>
                  <BatchPreviewRow
                    preview={p}
                    selected={selected.has(p.url)}
                    onToggle={() => toggleSelect(p.url)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={saving || fetching}
          >
            Cancelar
          </Button>
          {!previews && (
            <Button type="button" onClick={handleFetchAll} disabled={fetching || parseUrls().length === 0}>
              {fetching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Buscando todas…
                </>
              ) : (
                'Buscar todas'
              )}
            </Button>
          )}
          {previews && (
            <Button type="button" onClick={handleImportSelected} disabled={saving || selected.size === 0}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Importar selecionados ({selected.size})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchPreviewRow({
  preview,
  selected,
  onToggle,
}: {
  preview: UrlBatchPreview;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border p-2 transition-colors',
        preview.ok
          ? 'border-border bg-background hover:bg-muted/50'
          : 'border-destructive/30 bg-destructive/5',
      )}
    >
      {preview.ok ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-0.5 h-4 w-4"
        />
      ) : (
        <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {preview.ok ? (
          <>
            <span className="truncate text-sm font-medium">{preview.title}</span>
            <span className="truncate text-[11px] text-muted-foreground">{preview.url}</span>
            <span className="text-[10px] text-muted-foreground">
              {preview.char_count?.toLocaleString('pt-BR')} chars
              {preview.truncated && ' · truncado'}
            </span>
          </>
        ) : (
          <>
            <span className="truncate text-sm text-destructive">{preview.url}</span>
            <span className="text-[11px] text-destructive/80">{preview.error}</span>
          </>
        )}
      </div>
      {preview.ok && <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />}
    </div>
  );
}
