'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Sparkles, Loader2, Send, Archive, CheckCircle2, ExternalLink, AlertCircle } from 'lucide-react';
import { blogAiApi, BLOG_PILLARS, type BlogPost } from '@/lib/api/blog-ai';
import { ApiError } from '@/lib/api/client';

const BLOG_BASE = 'https://eclick.app.br/blog';

export default function BlogIaPage() {
  const t = useTranslations('blogIa');

  const [topic, setTopic] = useState('');
  const [pillar, setPillar] = useState(BLOG_PILLARS[0]?.slug ?? 'geo-101');
  const [notes, setNotes] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  async function onGenerate() {
    if (!topic.trim() || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const post = await blogAiApi.generate({ topic: topic.trim(), pillar, notes: notes.trim() || undefined });
      setPosts((prev) => [post, ...prev.filter((p) => p.id !== post.id)]);
      setTopic('');
      setNotes('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errorGeneric'));
    } finally {
      setGenerating(false);
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
  t,
}: {
  post: BlogPost;
  busy: boolean;
  onPublish: () => void;
  onReject: () => void;
  t: (k: string) => string;
}) {
  const statusLabel =
    post.status === 'published'
      ? t('published')
      : post.status === 'review'
        ? t('review')
        : post.status === 'failed'
          ? t('failed')
          : post.status === 'archived'
            ? t('archived')
            : post.status;
  const statusColor =
    post.status === 'published'
      ? 'bg-green-500/15 text-green-500'
      : post.status === 'failed'
        ? 'bg-destructive/15 text-destructive'
        : post.status === 'review'
          ? 'bg-primary/15 text-primary'
          : 'bg-muted text-muted-foreground';

  const canPublish = post.status === 'review' || post.status === 'approved' || post.status === 'scheduled';

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
      <div className="flex shrink-0 flex-col items-end justify-center gap-1.5">
        {post.status === 'published' ? (
          <a
            href={`${BLOG_BASE}/${post.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {t('viewLive')} <ExternalLink className="h-3 w-3" />
          </a>
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
