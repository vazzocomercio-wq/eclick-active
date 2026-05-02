'use client';

import { useState } from 'react';
import { ExternalLink, Link as LinkIcon, Loader2, RefreshCw, Save } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { knowledgeApi, type UrlPreview } from '@/lib/api/knowledge';
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

interface ImportUrlDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportUrlDialog({ open, onOpenChange, onImported }: ImportUrlDialogProps) {
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<UrlPreview | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [category, setCategory] = useState<KnowledgeCategory>('general');

  function reset() {
    setUrl('');
    setPreview(null);
    setEditTitle('');
    setEditContent('');
    setCategory('general');
  }

  async function handleFetch() {
    if (!url.trim()) {
      toast.error('Informe uma URL');
      return;
    }
    setFetching(true);
    try {
      const r = await knowledgeApi.previewUrl(url.trim());
      setPreview(r);
      setEditTitle(r.title);
      setEditContent(r.content);
      if (r.truncated) {
        toast.info('Conteúdo truncado em 50.000 caracteres', {
          description: 'A página é muito grande — só os primeiros 50k chars foram extraídos.',
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro';
      toast.error('Não foi possível acessar esta URL', { description: msg });
    } finally {
      setFetching(false);
    }
  }

  async function handleSave() {
    if (!preview) return;
    if (!editTitle.trim() || !editContent.trim()) {
      toast.error('Título e conteúdo são obrigatórios');
      return;
    }
    setSaving(true);
    try {
      await knowledgeApi.confirmUrlImport({
        url: preview.url,
        title: editTitle.trim(),
        content: editContent.trim(),
        category,
      });
      toast.success('Documento importado', {
        description: `"${editTitle.slice(0, 60)}" salvo na base de conhecimento.`,
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
    if (!o && !saving && !fetching) {
      reset();
    }
    onOpenChange(o);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-primary" />
            Importar de URL
          </DialogTitle>
          <DialogDescription>
            Cole a URL de uma página (loja online, FAQ, blog post, descrição de produto…) e a IA extrai o conteúdo
            relevante automaticamente.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: URL */}
        <div className="flex flex-col gap-2">
          <Label>URL da página</Label>
          <div className="flex gap-2">
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.seusite.com.br/produtos"
              disabled={fetching || !!preview}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !preview && !fetching) {
                  e.preventDefault();
                  void handleFetch();
                }
              }}
            />
            {!preview && (
              <Button type="button" onClick={handleFetch} disabled={fetching || !url.trim()}>
                {fetching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Buscando…
                  </>
                ) : (
                  'Buscar conteúdo'
                )}
              </Button>
            )}
            {preview && (
              <Button type="button" variant="outline" onClick={reset}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" /> Tentar outra URL
              </Button>
            )}
          </div>
        </div>

        {/* Step 2: Preview + edit */}
        {preview && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <ExternalLink className="h-3 w-3" />
              <a
                href={preview.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate hover:text-foreground hover:underline"
              >
                {preview.url}
              </a>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Título</Label>
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Categoria</Label>
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

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label>Conteúdo extraído (editável)</Label>
                <span className="text-[11px] text-muted-foreground">
                  {editContent.length.toLocaleString('pt-BR')} chars · ~
                  {Math.ceil(editContent.length / 4).toLocaleString('pt-BR')} tokens
                  {preview.truncated && ' · truncado'}
                </span>
              </div>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={12}
                className="font-mono text-xs"
              />
            </div>
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
          {preview && (
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar na base
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
