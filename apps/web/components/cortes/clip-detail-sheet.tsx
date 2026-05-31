'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  AlertCircle,
  CalendarClock,
  CalendarOff,
  Check,
  ExternalLink,
  Eye,
  Heart,
  Instagram,
  Loader2,
  MessageCircle,
  Music2,
  Rocket,
  Save,
  Share2,
  Sparkles,
  Trash2,
  X,
  Youtube,
} from 'lucide-react';
import type {
  ClipPlatform,
  ClipPost,
  ClipRow,
  CortesAccounts,
  PublishAccount,
} from '@/lib/api/studio-cortes';
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
  const [approving, setApproving] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [accounts, setAccounts] = useState<CortesAccounts | null>(null);
  const [netEnabled, setNetEnabled] = useState<Record<ClipPlatform, boolean>>({
    instagram: true,
    tiktok: true,
    youtube: true,
  });
  const [netBusy, setNetBusy] = useState<ClipPlatform | null>(null);

  useEffect(() => {
    if (open && !accounts) void cortesApi.accounts().then(setAccounts).catch(() => {});
  }, [open, accounts]);

  // Semeia o seletor de redes a partir do estado salvo de cada post.
  useEffect(() => {
    if (!clip) return;
    const next: Record<ClipPlatform, boolean> = { instagram: true, tiktok: true, youtube: true };
    for (const p of clip.posts) next[p.platform] = p.enabled;
    setNetEnabled(next);
  }, [clip]);

  const postByPlatform = useMemo(() => {
    const map = new Map<ClipPlatform, ClipPost>();
    for (const p of clip?.posts ?? []) map.set(p.platform, p);
    return map;
  }, [clip]);

  if (!clip) return null;

  /** Liga/desliga uma rede de destino (persiste post.enabled na hora). */
  async function toggleNetwork(platform: ClipPlatform) {
    if (!clip) return;
    const post = clip.posts.find((p) => p.platform === platform);
    if (!post) {
      toast.error('Sem copy gerada pra esta rede ainda.');
      return;
    }
    if (post.status === 'publicado') return; // já publicado — não dá pra desligar
    const v = !netEnabled[platform];
    setNetEnabled((m) => ({ ...m, [platform]: v }));
    setNetBusy(platform);
    try {
      await cortesApi.updatePost(post.id, { enabled: v });
      onChanged();
    } catch (err) {
      setNetEnabled((m) => ({ ...m, [platform]: !v })); // rollback
      toast.error('Falha ao mudar a rede', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setNetBusy(null);
    }
  }

  /** Redes que de fato vão receber (tem copy + estão ligadas + não publicadas). */
  function activeTargets(): ClipPlatform[] {
    if (!clip) return [];
    return clip.posts
      .filter((p) => p.enabled && p.status !== 'publicado')
      .map((p) => p.platform);
  }

  async function handleApprove() {
    if (!clip) return;
    if (activeTargets().length === 0) {
      toast.error('Nenhuma rede selecionada', {
        description: 'Ligue ao menos uma rede em "Publicar em" antes de aprovar.',
      });
      return;
    }
    setApproving(true);
    try {
      await cortesApi.setClipStatus(clip.id, 'aprovado');
      toast.success('Corte aprovado! Publicando nas redes…');
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast.error('Falha ao aprovar', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setApproving(false);
    }
  }

  async function handleSchedule() {
    if (!clip || !scheduleAt) return;
    setScheduling(true);
    try {
      await cortesApi.scheduleClip(clip.id, new Date(scheduleAt).toISOString());
      toast.success('Agendado! Vai publicar no horário marcado.');
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast.error('Falha ao agendar', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setScheduling(false);
    }
  }

  async function handleUnschedule() {
    if (!clip) return;
    setScheduling(true);
    try {
      await cortesApi.scheduleClip(clip.id, null);
      toast.success('Agendamento cancelado — voltou pra "A revisar".');
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast.error('Falha ao desagendar', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setScheduling(false);
    }
  }

  async function handleDelete() {
    if (!clip) return;
    const published = clip.posts.some((p) => p.status === 'publicado');
    const msg = published
      ? 'Excluir este corte? O vídeo sai do sistema e do Drive definitivamente. Os posts já publicados nas redes continuam no ar (não são removidos).'
      : 'Excluir este corte definitivamente? O vídeo é apagado do Drive e os registros do sistema. Não tem como desfazer.';
    if (!window.confirm(msg)) return;
    setDeleting(true);
    try {
      await cortesApi.deleteClip(clip.id);
      toast.success('Corte excluído do sistema.');
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast.error('Falha ao excluir', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setDeleting(false);
    }
  }

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
            Escolha as redes de destino e edite a copy de cada uma. Ao aprovar, publica só nas redes ligadas.
          </SheetDescription>

          {/* Seletor de redes de destino — liga/desliga cada uma num clique */}
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Publicar em
            </p>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map(({ id, label, Icon }) => {
                const post = clip.posts.find((p) => p.platform === id);
                const hasPost = Boolean(post);
                const published = post?.status === 'publicado';
                const on = hasPost && netEnabled[id];
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={!hasPost || netBusy === id || published}
                    onClick={() => toggleNetwork(id)}
                    title={
                      !hasPost
                        ? 'Sem copy gerada pra esta rede'
                        : published
                          ? 'Já publicado nesta rede'
                          : on
                            ? 'Clique para NÃO enviar nesta rede'
                            : 'Clique para enviar nesta rede'
                    }
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                      on
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'border-border bg-muted/40 text-muted-foreground',
                      (!hasPost || published) && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    {netBusy === id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Icon className="h-3.5 w-3.5" />
                    )}
                    {label}
                    {hasPost &&
                      !published &&
                      (on ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      ))}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Verde = vai publicar. Cinza = não envia. Ajuste a copy e a conta de cada rede nas abas abaixo.
            </p>
          </div>

          {clip.status === 'a_revisar' && (
            <div className="mt-2 flex flex-col gap-2">
              <Button onClick={handleApprove} disabled={approving || scheduling}>
                {approving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4" />
                )}
                <span className="ml-1.5">Aprovar e publicar agora</span>
              </Button>
              <div className="flex items-center gap-2">
                <Input
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  className="h-9 flex-1"
                />
                <Button
                  variant="outline"
                  onClick={handleSchedule}
                  disabled={!scheduleAt || scheduling || approving}
                >
                  {scheduling ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CalendarClock className="h-4 w-4" />
                  )}
                  <span className="ml-1.5">Agendar</span>
                </Button>
              </div>
            </div>
          )}
          {clip.status === 'aprovado' && (
            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
              Aprovado — publicando nas redes…
            </p>
          )}
          {clip.status === 'agendado' && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-cyan-600 dark:text-cyan-400">
                <CalendarClock className="h-3.5 w-3.5" />
                Agendado{scheduledLabel(clip) ? ` para ${scheduledLabel(clip)}` : ''}
              </span>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={handleUnschedule} disabled={scheduling}>
                  <CalendarOff className="h-3.5 w-3.5" />
                  <span className="ml-1">Desagendar</span>
                </Button>
                <Button size="sm" onClick={handleApprove} disabled={approving}>
                  <Rocket className="h-3.5 w-3.5" />
                  <span className="ml-1">Publicar agora</span>
                </Button>
              </div>
            </div>
          )}
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
                    accounts={accounts ? accounts[id] : []}
                    onSaved={onChanged}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </div>

          {/* Excluir corte (definitivo) */}
          <div className="border-t border-border px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Excluir corte</p>
                <p className="text-[11px] text-muted-foreground">
                  Apaga o vídeo do Drive e remove do sistema. Não dá pra desfazer.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="border-red-500/40 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                <span className="ml-1.5">Excluir</span>
              </Button>
            </div>
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
  accounts,
  onSaved,
}: {
  platform: ClipPlatform;
  post: ClipPost | null;
  accounts: PublishAccount[];
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [copy, setCopy] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [accountId, setAccountId] = useState('');

  useEffect(() => {
    setTitle(post?.title ?? '');
    setCopy(post?.copy ?? '');
    setHashtags((post?.hashtags ?? []).join(', '));
    setScheduledAt(toLocalInput(post?.scheduled_at ?? null));
    setEnabled(post?.enabled ?? true);
    setAccountId(post?.account_id ?? '');
  }, [post]);

  // Salva conta/toggle na hora (sem precisar do botão Salvar).
  async function persist(patch: { enabled?: boolean; account_id?: string | null }) {
    if (!post) return;
    try {
      await cortesApi.updatePost(post.id, patch);
      onSaved();
    } catch (err) {
      toast.error('Falha ao salvar', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    }
  }

  async function connectYouTube() {
    try {
      const { url } = await cortesApi.youtubeConnect();
      window.location.href = url;
    } catch (err) {
      toast.error('Falha ao conectar canal', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    }
  }

  async function connectInstagram() {
    try {
      const { url } = await cortesApi.instagramConnect();
      window.location.href = url;
    } catch (err) {
      toast.error('Falha ao conectar Instagram', {
        description: err instanceof ApiError ? err.message : String(err),
      });
    }
  }

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

  const published = post.status === 'publicado';
  const failed = post.status === 'falhou';
  const m = post.metrics ?? {};

  return (
    <div className="flex flex-col gap-3">
      {/* Conta de destino (liga/desliga a rede é no topo, em "Publicar em") */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-2.5">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
            enabled
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : 'bg-muted text-muted-foreground',
          )}
        >
          <span className={cn('h-2 w-2 rounded-full', enabled ? 'bg-emerald-500' : 'bg-muted-foreground')} />
          {enabled ? 'Vai publicar' : 'Rede desligada (ligue em "Publicar em")'}
        </span>

        {accounts.length > 0 ? (
          <div className="ml-auto flex items-center gap-1.5">
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                void persist({ account_id: e.target.value || null });
              }}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              {platform === 'youtube' ? null : <option value="">Conta padrão</option>}
              {accounts.map((a, i) => (
                <option key={a.id} value={a.id}>
                  {a.username || a.name || `Conta ${i + 1}`}
                </option>
              ))}
            </select>
            {platform === 'youtube' ? (
              <button
                type="button"
                onClick={connectYouTube}
                className="whitespace-nowrap text-[11px] text-primary hover:underline"
              >
                + canal
              </button>
            ) : platform === 'instagram' ? (
              <button
                type="button"
                onClick={connectInstagram}
                className="whitespace-nowrap text-[11px] text-primary hover:underline"
              >
                + conta
              </button>
            ) : (
              <Link
                href="/configuracoes/social"
                className="whitespace-nowrap text-[11px] text-primary hover:underline"
              >
                + conta
              </Link>
            )}
          </div>
        ) : platform === 'youtube' ? (
          <button
            type="button"
            onClick={connectYouTube}
            className="ml-auto whitespace-nowrap rounded-md border border-primary/40 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/5"
          >
            Conectar canal do YouTube
          </button>
        ) : platform === 'instagram' ? (
          <button
            type="button"
            onClick={connectInstagram}
            className="ml-auto whitespace-nowrap rounded-md border border-primary/40 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/5"
          >
            Conectar Instagram
          </button>
        ) : (
          <Link
            href="/configuracoes/social"
            className="ml-auto whitespace-nowrap rounded-md border border-primary/40 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/5"
          >
            Conectar TikTok no Social AI →
          </Link>
        )}
      </div>

      {/* Status da publicação (Sprint 2) */}
      {published && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
          <span className="font-medium text-emerald-600 dark:text-emerald-400">Publicado</span>
          {post.external_post_url && (
            <a
              href={post.external_post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> ver post
            </a>
          )}
          <span className="ml-auto inline-flex items-center gap-3 tabular-nums text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{m.views ?? 0}</span>
            <span className="inline-flex items-center gap-1"><Heart className="h-3 w-3" />{m.likes ?? 0}</span>
            <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" />{m.comments ?? 0}</span>
            <span className="inline-flex items-center gap-1"><Share2 className="h-3 w-3" />{m.shares ?? 0}</span>
          </span>
        </div>
      )}
      {failed && (
        <div className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Falha ao publicar: {post.error ?? 'erro'}</span>
        </div>
      )}

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
          Vazio = publica ao aprovar o corte. Com horário = vai pra coluna Agendado e publica na hora marcada.
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
function scheduledLabel(clip: ClipRow): string {
  const at = clip.posts.find((p) => p.scheduled_at)?.scheduled_at;
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
