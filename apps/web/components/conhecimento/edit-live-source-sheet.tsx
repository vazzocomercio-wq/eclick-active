'use client';

import { useEffect, useState } from 'react';
import { Globe, Loader2, PlayCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { KnowledgeLiveSource } from '@eclick-active/shared';
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
import { knowledgeApi } from '@/lib/api/knowledge';
import { ApiError } from '@/lib/api/client';
import { useConfirm } from '@/components/ui/confirm-provider';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format';

const TTL_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hora' },
  { value: 360, label: '6 horas' },
  { value: 1440, label: '24 horas' },
];

interface EditLiveSourceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: KnowledgeLiveSource | null;
  onChanged: () => void;
}

export function EditLiveSourceSheet({ open, onOpenChange, source, onChanged }: EditLiveSourceSheetProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [sourceType, setSourceType] = useState<'webpage' | 'api_endpoint' | 'rss_feed'>('webpage');
  const [ttl, setTtl] = useState(60);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirm = useConfirm();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; content?: string; error?: string } | null>(null);

  useEffect(() => {
    if (source) {
      setName(source.name);
      setUrl(source.url);
      setDescription(source.description ?? '');
      setSourceType(source.source_type);
      setTtl(source.cache_ttl_minutes);
      setIsActive(source.is_active);
      setTestResult(null);
    }
  }, [source]);

  async function handleSave() {
    if (!source) return;
    setSaving(true);
    try {
      await knowledgeApi.updateLiveSource(source.id, {
        name: name.trim(),
        url: url.trim(),
        description: description.trim() || undefined,
        source_type: sourceType,
        cache_ttl_minutes: ttl,
        is_active: isActive,
      });
      toast.success('Fonte atualizada');
      onChanged();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro';
      toast.error('Falha ao salvar', { description: msg });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!source) return;
    const ok = await confirm({
      title: `Deletar fonte "${source.name}"?`,
      description: 'Essa ação não pode ser desfeita.',
      variant: 'destructive',
      confirmLabel: 'Deletar',
      icon: Trash2,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await knowledgeApi.deleteLiveSource(source.id);
      toast.success('Fonte deletada');
      onChanged();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro';
      toast.error('Falha ao deletar', { description: msg });
    } finally {
      setDeleting(false);
    }
  }

  async function handleTest() {
    if (!source) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await knowledgeApi.testLiveSource(source.id);
      setTestResult(r);
      if (r.ok) {
        toast.success('Fonte respondendo', {
          description: `${r.char_count?.toLocaleString('pt-BR') ?? '?'} chars extraídos.`,
        });
      } else {
        toast.error('Fonte com problema', { description: r.error });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro';
      toast.error('Falha ao testar', { description: msg });
    } finally {
      setTesting(false);
    }
  }

  if (!source) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Editar fonte live
          </SheetTitle>
          <SheetDescription>
            Última consulta {source.last_fetched_at ? formatRelativeTime(source.last_fetched_at) : 'nunca'}.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 py-4">
          <div className="flex flex-col gap-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>URL</Label>
            <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Descrição</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Tipo</Label>
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
                className={cn(
                  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              >
                <option value="webpage">Página web</option>
                <option value="api_endpoint">Endpoint API</option>
                <option value="rss_feed">Feed RSS</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Cache TTL</Label>
              <select
                value={ttl}
                onChange={(e) => setTtl(Number(e.target.value))}
                className={cn(
                  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              >
                {TTL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 cursor-pointer"
            />
            <span>Fonte ativa (a IA pode consultar)</span>
          </label>

          <Button type="button" variant="outline" onClick={handleTest} disabled={testing} className="self-start">
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
            Testar fonte
          </Button>

          {testResult && (
            <div
              className={cn(
                'flex flex-col gap-1 rounded-md border p-3 text-xs',
                testResult.ok
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-destructive/40 bg-destructive/5',
              )}
            >
              {testResult.ok ? (
                <>
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">Conteúdo extraído</span>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                    {testResult.content?.slice(0, 1500) ?? ''}
                    {testResult.content && testResult.content.length > 1500 ? '\n\n…' : ''}
                  </pre>
                </>
              ) : (
                <span className="text-destructive">{testResult.error}</span>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Deletar
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="button" onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
