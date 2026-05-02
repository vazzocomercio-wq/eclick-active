'use client';

import { useRef, useState } from 'react';
import {
  FileSpreadsheet,
  FileText,
  FileType2,
  FileUp,
  Loader2,
  Save,
  X,
} from 'lucide-react';
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
import {
  knowledgeApi,
  type FileType,
  type FileUploadPreview,
} from '@/lib/api/knowledge';
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

const ACCEPT = '.pdf,.xlsx,.xls,.csv,.docx,.txt,.md';
const MAX_BYTES = 10 * 1024 * 1024;
const TOKEN_CHUNK_LIMIT = 8000;

interface UploadFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function UploadFileDialog({ open, onOpenChange, onImported }: UploadFileDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<FileUploadPreview | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [category, setCategory] = useState<KnowledgeCategory>('general');
  const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setEditTitle('');
    setEditContent('');
    setCategory('general');
    setSelectedSheets(new Set());
  }

  function handleSelect(f: File | null) {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast.error('Arquivo maior que 10MB', {
        description: `Tamanho recebido: ${(f.size / 1024 / 1024).toFixed(1)}MB`,
      });
      return;
    }
    setFile(f);
  }

  async function handleExtract() {
    if (!file) return;
    setExtracting(true);
    try {
      const r = await knowledgeApi.uploadFile(file);
      setPreview(r);
      const baseTitle = r.filename.replace(/\.[^.]+$/, '');
      setEditTitle(baseTitle);
      setEditContent(r.content);
      // Pré-seleciona todas as sheets se for Excel
      if (r.sheets && r.sheets.length > 0) {
        setSelectedSheets(new Set(r.sheets.map((s) => s.name)));
      }
      if (r.truncated) {
        toast.info('Conteúdo truncado em 100.000 caracteres', {
          description: 'O arquivo é muito grande — só os primeiros 100k chars foram extraídos.',
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro';
      toast.error('Falha ao extrair conteúdo', { description: msg });
    } finally {
      setExtracting(false);
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
      const isExcel = preview.sheets && preview.sheets.length > 0 && selectedSheets.size > 0;
      const sheetsToImport = isExcel
        ? preview.sheets!.filter((s) => selectedSheets.has(s.name)).map((s) => ({
            name: s.name,
            content: s.content,
            rows: s.rows,
          }))
        : undefined;

      const docs = await knowledgeApi.confirmFileUpload({
        filename: preview.filename,
        title: editTitle.trim(),
        content: editContent.trim(),
        category,
        file_type: preview.file_type,
        file_size: preview.file_size,
        ...(preview.pages_count !== undefined ? { pages_count: preview.pages_count } : {}),
        ...(sheetsToImport ? { selected_sheets: sheetsToImport } : {}),
      });
      toast.success(`${docs.length} documento${docs.length === 1 ? '' : 's'} importado${docs.length === 1 ? '' : 's'}`, {
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
    if (!o && !saving && !extracting) reset();
    onOpenChange(o);
  }

  function toggleSheet(name: string) {
    setSelectedSheets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const tokenEstimate = preview ? Math.ceil(editContent.length / 4) : 0;
  const willChunk = tokenEstimate > TOKEN_CHUNK_LIMIT && !(preview?.sheets && selectedSheets.size > 0);
  const chunkCount = willChunk ? Math.ceil(tokenEstimate / 4000) : 1;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-4 w-4 text-primary" />
            Upload de arquivo
          </DialogTitle>
          <DialogDescription>
            Suba PDF, Excel/CSV, Word ou TXT. A IA extrai o texto e adiciona à base de conhecimento. Limite 10MB.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: file picker / dropzone */}
        {!preview && (
          <div className="flex flex-col gap-3">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleSelect(f);
              }}
              onClick={() => inputRef.current?.click()}
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 transition-colors cursor-pointer',
                dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card hover:border-primary/40 hover:bg-muted/30',
              )}
            >
              <FileUp className={cn('h-10 w-10', dragOver ? 'text-primary' : 'text-muted-foreground')} />
              <p className="text-sm font-medium">
                {file ? file.name : 'Arraste um arquivo ou clique para selecionar'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                PDF · Excel (xlsx/xls/csv) · Word (docx) · TXT · MD — até 10MB
              </p>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => handleSelect(e.target.files?.[0] ?? null)}
                disabled={extracting}
              />
            </div>

            {file && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                <FileTypeIcon filename={file.name} className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate font-medium">{file.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {(file.size / 1024).toFixed(0)} KB
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFile(null)}
                  disabled={extracting}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Step 2: preview + edit */}
        {preview && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
              <FileTypeIcon filename={preview.filename} className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{preview.filename}</span>
              <span className="text-muted-foreground">·</span>
              <span className="uppercase text-muted-foreground">{preview.file_type}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {(preview.file_size / 1024).toFixed(0)} KB
              </span>
              {preview.pages_count !== undefined && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{preview.pages_count} páginas</span>
                </>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Título</Label>
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={200} />
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

            {/* Excel sheets selector */}
            {preview.sheets && preview.sheets.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label>Sheets do Excel ({preview.sheets.length}) — cada uma vira um documento separado</Label>
                <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-card p-2">
                  {preview.sheets.map((s) => (
                    <li key={s.name} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={selectedSheets.has(s.name)}
                        onChange={() => toggleSheet(s.name)}
                        className="h-4 w-4 cursor-pointer"
                      />
                      <span className="font-medium">{s.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        — {s.rows.toLocaleString('pt-BR')} linhas · {s.content.length.toLocaleString('pt-BR')} chars
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label>Conteúdo extraído (editável)</Label>
                <span className="text-[11px] text-muted-foreground">
                  {editContent.length.toLocaleString('pt-BR')} chars · ~
                  {tokenEstimate.toLocaleString('pt-BR')} tokens
                  {preview.truncated && ' · truncado'}
                </span>
              </div>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={10}
                className="font-mono text-xs"
              />
              {willChunk && (
                <p className="rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                  ⚠️ Conteúdo grande — será dividido em <strong>{chunkCount} partes</strong> de ~4000 tokens com overlap pra busca semântica funcionar bem.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={saving || extracting}
          >
            Cancelar
          </Button>
          {!preview && (
            <Button type="button" onClick={handleExtract} disabled={!file || extracting}>
              {extracting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Extraindo conteúdo…
                </>
              ) : (
                'Extrair conteúdo'
              )}
            </Button>
          )}
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

export function FileTypeIcon({ filename, className }: { filename: string; className?: string }) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return <FileText className={className} />;
  if (['xlsx', 'xls', 'csv'].includes(ext)) return <FileSpreadsheet className={className} />;
  if (ext === 'docx' || ext === 'doc') return <FileType2 className={className} />;
  return <FileText className={className} />;
}

export function fileTypeLabel(ft: FileType): string {
  switch (ft) {
    case 'pdf':
      return 'PDF';
    case 'excel':
      return 'Excel';
    case 'csv':
      return 'CSV';
    case 'word':
      return 'Word';
    case 'text':
      return 'TXT';
  }
}
