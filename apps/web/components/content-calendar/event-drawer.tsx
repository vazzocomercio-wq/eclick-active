'use client';

import { useEffect, useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  contentCalendarApi,
  CHANNEL_COLOR,
  CHANNEL_LABEL,
  CONTENT_TYPE_LABEL,
  STATUS_LABEL,
  type ContentCalendarEvent,
  type ContentChannel,
  type ContentStatus,
  type ContentType,
  type CreateEventInput,
  type UpdateEventInput,
} from '@/lib/api/content-calendar';
import {
  saasApi,
  type SaasProduct,
  SaasApiError,
} from '@/lib/saas-api';
import { cn } from '@/lib/utils';

interface EventDrawerProps {
  open: boolean;
  /** Quando vier, drawer é em modo edição. Se null/undefined, modo criar. */
  event?: ContentCalendarEvent | null;
  /** Pré-preenche scheduled_date no modo criar (ex: clique numa célula). */
  defaultDate?: string;
  onClose: () => void;
  onSaved: (event: ContentCalendarEvent) => void;
  onDeleted: (id: string) => void;
}

type Tab = 'detalhes' | 'vincular' | 'notas';

const CHANNELS: ContentChannel[] = [
  'instagram',
  'facebook',
  'tiktok',
  'whatsapp',
  'email',
  'meta_ads',
  'google_ads',
];

const CONTENT_TYPES: ContentType[] = [
  'social_post',
  'story',
  'reel',
  'tiktok',
  'email',
  'whatsapp_broadcast',
  'ad_launch',
];

const STATUSES: ContentStatus[] = [
  'idea',
  'planned',
  'content_ready',
  'approved',
  'scheduled',
  'published',
  'cancelled',
];

/**
 * Drawer pra criar/editar evento. Tabs: Detalhes / Vincular SaaS / Notas.
 * Vincular SaaS chama o helper `saasApi`; se não configurado ou falha,
 * desabilita a aba com tooltip explicativo.
 */
export function EventDrawer({
  open,
  event,
  defaultDate,
  onClose,
  onSaved,
  onDeleted,
}: EventDrawerProps) {
  const t = useTranslations('contentCalendar');
  const isEdit = !!event;

  const [tab, setTab] = useState<Tab>('detalhes');
  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState<ContentType>('social_post');
  const [channel, setChannel] = useState<ContentChannel>('instagram');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [status, setStatus] = useState<ContentStatus>('planned');
  const [notes, setNotes] = useState('');
  const [productId, setProductId] = useState<string | null>(null);
  const [productSnap, setProductSnap] = useState<SaasProduct | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<SaasProduct[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset / hidrata quando abre
  useEffect(() => {
    if (!open) return;
    if (event) {
      setTitle(event.title);
      setContentType(event.content_type);
      setChannel(event.channel);
      setScheduledDate(event.scheduled_date);
      setScheduledTime(event.scheduled_time?.slice(0, 5) ?? '');
      setStatus(event.status);
      setNotes(event.notes ?? '');
      setProductId(event.product_id);
      const snap = (event.resource_snapshot?.product as SaasProduct | undefined) ?? null;
      setProductSnap(snap ?? null);
    } else {
      setTitle('');
      setContentType('social_post');
      setChannel('instagram');
      setScheduledDate(defaultDate ?? new Date().toISOString().slice(0, 10));
      setScheduledTime('');
      setStatus('planned');
      setNotes('');
      setProductId(null);
      setProductSnap(null);
    }
    setProductSearch('');
    setProductResults([]);
    setError(null);
    setTab('detalhes');
  }, [open, event, defaultDate]);

  // Search produtos no SaaS (debounced manual)
  useEffect(() => {
    if (tab !== 'vincular') return;
    if (!saasApi.configured()) return;
    if (productSearch.trim().length < 2) {
      setProductResults([]);
      return;
    }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setProductSearching(true);
      try {
        const results = await saasApi.searchProducts(
          productSearch,
          10,
          ctrl.signal,
        );
        setProductResults(results);
      } catch (err) {
        if (!(err instanceof SaasApiError) && err instanceof DOMException) return;
        setProductResults([]);
      } finally {
        setProductSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [tab, productSearch]);

  async function handleSave() {
    if (!title.trim() || !scheduledDate) {
      setError(t('drawer.requiredError'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const time = scheduledTime ? `${scheduledTime}:00` : null;
      const snapshot: Record<string, unknown> = {};
      if (productSnap) {
        snapshot.product = {
          name: productSnap.name,
          thumbnail_url: productSnap.thumbnail_url ?? null,
        };
      }

      if (isEdit && event) {
        const patch: UpdateEventInput = {
          title: title.trim(),
          content_type: contentType,
          channel,
          scheduled_date: scheduledDate,
          scheduled_time: time,
          status,
          notes: notes.trim() || null,
          product_id: productId,
          resource_snapshot: snapshot,
        };
        const updated = await contentCalendarApi.update(event.id, patch);
        onSaved(updated);
      } else {
        const body: CreateEventInput = {
          title: title.trim(),
          content_type: contentType,
          channel,
          scheduled_date: scheduledDate,
          scheduled_time: time,
          status,
          notes: notes.trim() || null,
          product_id: productId,
          resource_snapshot: snapshot,
        };
        const created = await contentCalendarApi.create(body);
        onSaved(created);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('drawer.saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!event) return;
    if (!confirm(t('drawer.deleteConfirm'))) return;
    setBusy(true);
    try {
      await contentCalendarApi.remove(event.id);
      onDeleted(event.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('drawer.deleteError'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const channelColor = CHANNEL_COLOR[channel];
  const saasConfigured = saasApi.configured();

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* drawer */}
      <div className="relative flex h-full w-full max-w-lg flex-col border-l border-border bg-background shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: channelColor }}
            />
            <h2 className="text-sm font-semibold">
              {isEdit ? t('drawer.editTitle') : t('drawer.newTitle')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border px-4">
          {(['detalhes', 'vincular', 'notas'] as Tab[]).map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setTab(tabKey)}
              disabled={tabKey === 'vincular' && !saasConfigured}
              title={
                tabKey === 'vincular' && !saasConfigured
                  ? t('drawer.tabs.vincularDisabledTooltip')
                  : undefined
              }
              className={cn(
                'border-b-2 px-3 py-2 text-xs font-medium capitalize transition-colors',
                tab === tabKey
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
                tabKey === 'vincular' && !saasConfigured && 'opacity-50 cursor-not-allowed',
              )}
            >
              {t(`drawer.tabs.${tabKey}`)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {tab === 'detalhes' && (
            <div className="space-y-3">
              <Field label={t('drawer.fields.titleLabel')}>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('drawer.fields.titlePlaceholder')}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
                  maxLength={200}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t('drawer.fields.channelLabel')}>
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as ContentChannel)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    {CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('drawer.fields.typeLabel')}>
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value as ContentType)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    {CONTENT_TYPES.map((ct) => (
                      <option key={ct} value={ct}>
                        {CONTENT_TYPE_LABEL[ct]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t('drawer.fields.dateLabel')}>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </Field>
                <Field label={t('drawer.fields.timeLabel')}>
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </Field>
              </div>

              <Field label={t('drawer.fields.statusLabel')}>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ContentStatus)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {tab === 'vincular' && (
            <div className="space-y-3">
              {!saasConfigured ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  {t('drawer.saas.notConfigured')}
                </div>
              ) : (
                <>
                  <Field label={t('drawer.saas.linkProductLabel')}>
                    <input
                      type="text"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder={t('drawer.saas.searchPlaceholder')}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    />
                  </Field>

                  {productSearching && (
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> {t('drawer.saas.searching')}
                    </p>
                  )}

                  {productResults.length > 0 && (
                    <div className="space-y-1">
                      {productResults.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setProductId(p.id);
                            setProductSnap(p);
                            setProductResults([]);
                            setProductSearch('');
                          }}
                          className="flex w-full items-center gap-2 rounded-md border border-border bg-card/40 px-2.5 py-2 text-left text-xs hover:bg-accent"
                        >
                          {p.thumbnail_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.thumbnail_url}
                              alt=""
                              className="h-8 w-8 rounded object-cover"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{p.name}</p>
                            {p.short_description && (
                              <p className="truncate text-[10px] text-muted-foreground">
                                {p.short_description}
                              </p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {productId && productSnap && (
                    <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
                      {productSnap.thumbnail_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={productSnap.thumbnail_url}
                          alt=""
                          className="h-8 w-8 rounded object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-emerald-200">
                          {t('drawer.saas.linkedPrefix', { name: productSnap.name })}
                        </p>
                        <p className="text-[10px] text-emerald-300/70">
                          {productId.slice(0, 8)}…
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setProductId(null);
                          setProductSnap(null);
                        }}
                        className="text-[11px] text-rose-300 hover:text-rose-200"
                      >
                        {t('drawer.saas.remove')}
                      </button>
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground">
                    {t('drawer.saas.comingSoonNote')}
                  </p>
                </>
              )}
            </div>
          )}

          {tab === 'notas' && (
            <Field label={t('drawer.fields.notesLabel')}>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={8}
                placeholder={t('drawer.fields.notesPlaceholder')}
                className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
                maxLength={2000}
              />
            </Field>
          )}

          {error && (
            <p className="mt-3 text-xs text-destructive">{error}</p>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          {isEdit ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> {t('drawer.delete')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              {t('drawer.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-400 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? t('drawer.save') : t('drawer.create')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
