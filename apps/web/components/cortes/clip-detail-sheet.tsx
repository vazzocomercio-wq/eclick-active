'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Instagram, Loader2, Music2, Save, Sparkles, Youtube } from 'lucide-react';
import type { ClipPlatform, ClipPost, ClipRow } from '@/lib/api/studio-cortes';
import { cortesApi } from '@/lib/api/studio-cortes';
import { ApiError } from '@/lib/api/client';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

const PLATFORMS: Array<{ id: ClipPlatform; label: string; Icon: typeof Instagram }> = [
  { id: 'instagram', label: 'Instagram', Icon: Instagram },
  { id: 'tiktok', label: 'TikTok', Icon: Music2 },
  { id: 'youtube', label: 'YouTube', Icon: Youtube },
];

interface ClipDetailSheetProps {
  clip: ClipRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

export function ClipDetailSheet({ clip, open, onOpenChange, onChanged }: ClipDetailSheetProps) {
  const [tab, setTab] = useState<ClipPlatform>('instagram');
  const [regenerating, setRegenerating] = useState(false);

  const postByPlatform = useMemo(() => {
    const map = new Map<ClipPlatform, ClipPost>();
    for (const p of clip?.posts ?? []) map.set(p.platform, p);
    return map;
  }, [clip]);

  if (!clip) return null;

  async function handleRegenerate() {
    if (!clip) return;
    setRegenerating(true);
    try {
      const r = await cortesApi.regenerateCopy(clip.job_id);
      toast.success(`Copys regeneradas (${r.generated} corte(s)).`);
      onChanged();
    } catch (err) {
      toast.error('Falha ao regenerar', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-base">{clip.title || clip.hook || 'Corte'}</SheetTitle>
          <SheetDescription className="text-xs">
            Edite as copys por plataforma. A publicação chega no Sprint 2.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Prévia + transcrição */}
          <div className="flex gap-3 border-b border-border p-5">
            <div className="h-44 w-[99px] shrink-0 overflow-hidden rounded-lg bg-muted/40">
              {clip.file_url ? (
                <video
                  src={clip.file_url}
                  poster={clip.thumbnail_url ?? undefined}
                  controls
                  playsInline
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  Sem prévia
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              {clip.hook && (
                <p className="mb-2 flex items-start gap-1.5 text-xs text-foreground">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="font-medium">{clip.hook}</span>
                </p>
              )}
              {clip.transcript ? (
                <p className="line-clamp-[8] text-xs leading-relaxed text-muted-foreground">
                  {clip.transcript}
                </p>
              ) : (
                <p className="text-xs italic text-muted-foreground">Sem transcrição.</p>
              )}
            </div>
          </div>

          {/* Editor de copys por plataforma */}
          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Copys por plataforma</h3>
              <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={regenerating}>
                {regenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                <span className="ml-1">Regenerar com IA</span>
              </Button>
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as ClipPlatform)}>
              <TabsList className="mb-3">
                {PLATFORMS.map(({ id, label, Icon }) => (
                  <TabsTrigger key={id} value={id}>
                    <Icon className="h-3.5 w-3.5" />
                    <span className="ml-1.5">{label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              {PLATFORMS.map(({ id }) => (
                <TabsContent key={id} value={id}>
                  <PlatformCopyEditor
                    platform={id}
                    post={postByPlatform.get(id) ?? null}
                    onSaved={onChanged}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Editor de uma plataforma ────────────────────────────────

function PlatformCopyEditor({
  platform,
  post,
  onSaved,
}: {
  platform: ClipPlatform;
  post: ClipPost | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [copy, setCopy] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(post?.title ?? '');
    setCopy(post?.copy ?? '');
    setHashtags((post?.hashtags ?? []).join(', '));
    setScheduledAt(toLocalInput(post?.scheduled_at ?? null));
  }, [post]);

  if (!post) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Copy ainda não gerada pra esta plataforma.
      </div>
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      await cortesApi.updatePost(post!.id, {
        title: platform === 'youtube' ? title.trim() || null : null,
        copy: copy.trim() || null,
        hashtags: hashtags
          .split(/[,\n]/)
          .map((h) => h.trim().replace(/^#/, ''))
          .filter(Boolean),
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      });
      toast.success('Copy salva.');
      onSaved();
    } catch (err) {
      toast.error('Falha ao salvar', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {platform === 'youtube' && (
        <div>
          <Label className="text-xs">Título (YouTube Shorts)</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="Título do Short"
            className="mt-1"
          />
        </div>
      )}

      <div>
        <Label className="text-xs">{platform === 'youtube' ? 'Descrição' : 'Legenda'}</Label>
        <Textarea
          value={copy}
          onChange={(e) => setCopy(e.target.value)}
          rows={6}
          placeholder="Escreva ou ajuste a copy…"
          className="mt-1 resize-y"
        />
      </div>

      <div>
        <Label className="text-xs">Hashtags (separadas por vírgula)</Label>
        <Input
          value={hashtags}
          onChange={(e) => setHashtags(e.target.value)}
          placeholder="vendas, ecommerce, dica"
          className="mt-1"
        />
      </div>

      <div>
        <Label className="text-xs">Agendar para (opcional)</Label>
        <Input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="mt-1"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          A publicação automática chega no Sprint 2 — por ora isto só registra o horário.
        </p>
      </div>

      <Button onClick={handleSave} disabled={saving} className={cn('mt-1 self-end')}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        <span className="ml-1.5">Salvar copy</span>
      </Button>
    </div>
  );
}

/** ISO → valor do input datetime-local (no fuso local). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
