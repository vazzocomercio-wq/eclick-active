'use client';

import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import type { KnowledgeCategory } from '@eclick-active/shared';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  knowledgeApi,
  type KnowledgeDocumentListItem,
} from '@/lib/api/knowledge';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { KNOWLEDGE_CATEGORIES, categoryLabel } from './category-badge';

interface EditDocumentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: KnowledgeDocumentListItem | null;
  onChanged: () => void;
}

export function EditDocumentSheet({
  open,
  onOpenChange,
  document,
  onChanged,
}: EditDocumentSheetProps) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<KnowledgeCategory>('general');
  const [content, setContent] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open && document) {
      setTitle(document.title);
      setCategory(document.category);
      setContent(document.content);
      setIsActive(document.is_active);
      setError(null);
      setConfirmDelete(false);
    }
  }, [open, document]);

  if (!document) return null;

  const dirty =
    title !== document.title ||
    category !== document.category ||
    content !== document.content ||
    isActive !== document.is_active;

  const contentChanged = content !== document.content;
  const tokens = estimateTokens(content);

  async function handleSave() {
    if (!document || !title.trim() || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await knowledgeApi.update(document.id, {
        title: title.trim(),
        category,
        content: content.trim(),
        is_active: isActive,
      });
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao salvar',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!document) return;
    setDeleting(true);
    setError(null);
    try {
      await knowledgeApi.remove(document.id);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erro ao excluir',
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !saving && !deleting && onOpenChange(o)}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-2xl" side="right">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>Editar documento</SheetTitle>
          <SheetDescription>
            Atualizado em {new Date(document.updated_at).toLocaleString('pt-BR')}
            {contentChanged && ' · embedding será regenerado ao salvar'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {error && (
            <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label className="text-xs">Título</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Categoria</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as KnowledgeCategory)}
                className={cn(
                  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              >
                {KNOWLEDGE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Conteúdo</Label>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                ~{tokens.toLocaleString('pt-BR')} tokens
              </span>
            </div>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={22}
              className="font-mono text-xs leading-relaxed"
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <input
              id="is-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="is-active" className="text-xs cursor-pointer">
              Ativo (visível para a IA)
            </Label>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          {confirmDelete ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-destructive">Excluir permanentemente?</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Sim, excluir
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Excluir
            </Button>
          )}

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Fechar
            </Button>
            <Button onClick={handleSave} disabled={!dirty || saving || !title.trim() || !content.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? 'Salvando...' : contentChanged ? 'Salvar + reindexar' : 'Salvar'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
