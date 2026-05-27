'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Sparkles, Loader2, Send, Archive, CheckCircle2, ExternalLink, AlertCircle, Clock, Lightbulb } from 'lucide-react';
import { blogAiApi, BLOG_PILLARS, type BlogPost, type BlogTopicIdea } from '@/lib/api/blog-ai';
import { ApiError } from '@/lib/api/client';

const BLOG_BASE = 'https://eclick.app.br/blog';

function pillarLabel(slug: string): string {
  return BLOG_PILLARS.find((p) => p.slug === slug)?.label ?? slug;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function BlogIaPage() {
  const t = useTranslations('blogIa');

  const [topic, setTopic] = useState('');
  const [pillar, setPillar] = useState(BLOG_PILLARS[0]?.slug ?? 'geo-101');
  const [notes, setNotes] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [seed, setSeed] = useState('');
  const [ideas, setIdeas] = useState<BlogTopicIdea[]>([]);
  const [ideating, setIdeating] = useState(false);

  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    blogAiApi
      .list()
      .then(setPosts)
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

  async function runGenerate(topicVal: string, pillarVal: string) {
    if (!topicVal.trim() || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const post = await blogAiApi.generate({ topic: topicVal.trim(), pillar: pillarVal, notes: notes.trim() || undefined });
      setPosts((prev) => [post, ...prev.filter((p) => p.id !== post.id)]);
      setTopic('');
      setNotes('');
      setIdeas([]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errorGeneric'));
    } finally {
      setGenerating(false);
    }
  }

  function onGenerate() {
    void runGenerate(topic, pillar);
  }

  async function onIdeate() {
    if (ideating) return;
    setIdeating(true);
    setError(null);
    try {
      const { topics } = await blogAiApi.ideate(seed.trim() || undefined);
      setIdeas(topics);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errorGeneric'));
    } finally {
      setIdeating(false);
    }
  }

  async function onPublish(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const updated = await blogAiApi.publish(id);
      setPosts((prev) => prev.map((p) => (p.id === id ? updated : p)));
      setToast(t('publishedToast'));
      setTimeout(() => setToast(null), 4000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errorGeneric'));
    } finally {
      setBusyId(null);
    }
  }

  async function onReject(id: string) {
    setBusyId(id);
    try {
      const updated = await blogAiApi.reject(id);
      setPosts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch {
      /* ignore */
    } finally {
      setBusyId(null);
    }
  }

  async function onSchedule(id: string, scheduledFor: string) {
    setBusyId(id);
    setError(null);
    try {
      const updated = await blogAiApi.schedule(id, scheduledFor);
      setPosts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errorGeneric'));
    } finally {
      setBusyId(null);
    }
  }

  async function onUnschedule(id: string) {
    setBusyId(id);
    try {
      const updated = await blogAiApi.unschedule(id);
      setPosts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch {
      /* ignore */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-wider">Blog IA</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Form */}
      <div className="rounded-xl border border-border bg-card p-5">
        <label className="mb-1.5 block text-sm font-medium text-foreground">{t('topicLabel')}</label>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={t('topicPlaceholder')}
          rows={2}
          className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">{t('pillarLabel')}</label>
            <select
              value={pillar}
              onChange={(e) => setPillar(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {BLOG_PILLARS.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">{t('notesLabel')}</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          onClick={onGenerate}
          disabled={generating || !topic.trim()}
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generating ? t('generating') : t('generate')}
        </button>
      </div>

      {/* Sugerir pautas (IA) */}
      <div className="mt-4 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">{t('ideateTitle')}</span>
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder={t('seedPlaceholder')}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={onIdeate}
            disabled={ideating}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            {ideating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
            {ideating ? t('ideating') : t('ideate')}
          </button>
        </div>
        {ideas.length > 0 && (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {ideas.map((idea, i) => (
              <li key={i} className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">{pillarLabel(idea.pillar)}</span>
                <span className="text-sm font-semibold text-foreground">{idea.title}</span>
                {idea.angle && <span className="text-xs text-muted-foreground">{idea.angle}</span>}
                <button
                  type="button"
                  onClick={() => runGenerate(idea.title, idea.pillar)}
                  disabled={generating}
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  <Sparkles className="h-3 w-3" /> {t('generate')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {toast && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
          <CheckCircle2 className="h-4 w-4" /> {toast}
        </div>
      )}

      {/* Lista */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {t('recent')}
      </h2>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> …
        </div>
      ) : posts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {posts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              busy={busyId === post.id}
              onPublish={() => onPublish(post.id)}
              onReject={() => onReject(post.id)}
              onSchedule={(iso) => onSchedule(post.id, iso)}
              onUnschedule={() => onUnschedule(post.id)}
              t={t}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PostRow({
  post,
  busy,
  onPublish,
  onReject,
  onSchedule,
  onUnschedule,
  t,
}: {
  post: BlogPost;
  busy: boolean;
  onPublish: () => void;
  onReject: () => void;
  onSchedule: (iso: string) => void;
  onUnschedule: () => void;
  t: (k: string) => string;
}) {
  const [scheduleAt, setScheduleAt] = useState('');

  const statusLabel =
    post.status === 'published' ? t('published')
    : post.status === 'review' ? t('review')
    : post.status === 'scheduled' ? t('scheduled')
    : post.status === 'failed' ? t('failed')
    : post.status === 'archived' ? t('archived')
    : post.status;
  const statusColor =
    post.status === 'published' ? 'bg-green-500/15 text-green-500'
    : post.status === 'failed' ? 'bg-destructive/15 text-destructive'
    : post.status === 'scheduled' ? 'bg-amber-500/15 text-amber-500'
    : post.status === 'review' ? 'bg-primary/15 text-primary'
    : 'bg-muted text-muted-foreground';

  const canPublish = post.status === 'review' || post.status === 'approved';

  return (
    <li className="flex gap-3 rounded-xl border border-border bg-card p-3">
      <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-md bg-background">
        {post.cover_image_url && (
          <Image src={post.cover_image_url} alt="" fill sizes="112px" className="object-cover" unoptimized />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${statusColor}`}>
            {statusLabel}
          </span>
          {post.reading_time_minutes ? (
            <span className="text-[11px] text-muted-foreground">{post.reading_time_minutes} min</span>
          ) : null}
        </div>
        <h3 className="mt-1 truncate text-sm font-semibold text-foreground">{post.title}</h3>
        <p className="line-clamp-1 text-xs text-muted-foreground">{post.excerpt ?? post.source_topic ?? ''}</p>
        {post.status === 'failed' && post.rejected_reason && (
          <p className="mt-0.5 text-[11px] text-destructive">{post.rejected_reason}</p>
        )}
      </div>
      <div className="flex w-44 shrink-0 flex-col items-end justify-center gap-1.5">
        {post.status === 'published' ? (
          <a
            href={`${BLOG_BASE}/${post.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {t('viewLive')} <ExternalLink className="h-3 w-3" />
          </a>
        ) : post.status === 'scheduled' ? (
          <>
            <span className="flex items-center gap-1 text-[11px] font-medium text-amber-500">
              <Clock className="h-3 w-3" /> {fmtDateTime(post.scheduled_for)}
            </span>
            <button
              type="button"
              onClick={onPublish}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {t('publishNow')}
            </button>
            <button
              type="button"
              onClick={onUnschedule}
              disabled={busy}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {t('unschedule')}
            </button>
          </>
        ) : (
          <>
            {canPublish && (
              <button
                type="button"
                onClick={onPublish}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {t('publish')}
              </button>
            )}
            {canPublish && (
              <div className="flex items-center gap-1">
                <input
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  className="w-[8.5rem] rounded border border-border bg-background px-1.5 py-1 text-[11px] outline-none focus:border-primary"
                />
                <button
                  type="button"
                  disabled={busy || !scheduleAt}
                  onClick={() => scheduleAt && onSchedule(new Date(scheduleAt).toISOString())}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-card disabled:opacity-40"
                  title={t('schedule')}
                >
                  <Clock className="h-3 w-3" /> {t('schedule')}
                </button>
              </div>
            )}
            {post.status !== 'archived' && (
              <button
                type="button"
                onClick={onReject}
                disabled={busy}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <Archive className="h-3.5 w-3.5" /> {t('reject')}
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}
