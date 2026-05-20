'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Download,
  ExternalLink,
  File,
  FileSpreadsheet,
  FileText,
  ImageOff,
  MapPin,
  Pause,
  Play,
  User as UserIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Message } from '@eclick-active/shared';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface MessageMediaProps {
  message: Message;
  /** Compact reduz max-widths pra caber em drawers. */
  compact?: boolean;
}

/**
 * Renderização rica de mídia nas mensagens. Detecta o tipo via:
 *   1. message.content_type explícito (preferencial)
 *   2. message.metadata.type (fallback)
 *   3. URL parsing em message.plain_text (auto-detect pra mensagens
 *      antigas que não tinham metadata estruturada)
 *
 * Tipos suportados:
 *   - image    → thumbnail + lightbox
 *   - audio    → player custom com waveform fake
 *   - video    → thumbnail + Dialog player
 *   - document → card com ícone tipado + tamanho + download
 *   - location → mini-map placeholder + Google Maps link
 *   - sticker  → imagem 120x120 sem borda
 *   - contact  → card com nome/telefone + "Adicionar como contato"
 *   - text     → fallback (texto plano)
 *
 * Loading: skeleton 4:3. Fallback: card de erro com ícone ImageOff/etc.
 */
export function MessageMedia({ message, compact = false }: MessageMediaProps) {
  const t = useTranslations('chat.media');
  const c = (message.content as Record<string, unknown> | null) ?? {};
  const meta = (message.metadata as Record<string, unknown> | null) ?? {};
  const explicitType = (meta.type as string | undefined) ?? message.content_type;

  // Auto-detect a partir de URL em texto, pra mensagens antigas
  const detected = explicitType ?? detectFromText(message.plain_text ?? '');

  const url = (c.url as string | undefined) ?? (meta.url as string | undefined) ?? extractUrl(message.plain_text ?? '');
  const caption = (c.caption as string | undefined) ?? (meta.caption as string | undefined);
  const filename = (c.filename as string | undefined) ?? (meta.filename as string | undefined);
  const fileSize = (c.size as number | undefined) ?? (meta.size as number | undefined);
  const duration = (c.duration as number | undefined) ?? (meta.duration as number | undefined);

  switch (detected) {
    case 'image':
      return <ImageMedia url={url} caption={caption} compact={compact} />;
    case 'sticker':
      return <StickerMedia url={url} />;
    case 'audio':
    case 'voice':
      return <AudioMedia url={url} duration={duration} compact={compact} />;
    case 'video':
      return <VideoMedia url={url} compact={compact} />;
    case 'document':
      return (
        <DocumentMedia
          url={url}
          filename={filename}
          size={fileSize}
          compact={compact}
        />
      );
    case 'location':
      return (
        <LocationMedia
          lat={(c.lat as number) ?? (meta.lat as number)}
          lng={(c.lng as number) ?? (meta.lng as number)}
          name={(c.name as string) ?? (meta.name as string)}
          address={(c.address as string) ?? (meta.address as string)}
          compact={compact}
        />
      );
    case 'contact':
      return (
        <ContactMedia
          name={(c.name as string) ?? (meta.name as string)}
          phone={(c.phone as string) ?? (meta.phone as string)}
        />
      );
    case 'system':
      return (
        <p className="text-xs italic text-muted-foreground">
          {(c.event as string) ?? t('systemEvent')}
        </p>
      );
    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {(c.body as string) ?? message.plain_text ?? ''}
        </p>
      );
  }
}

// ──────────────────────────────────────────────────────────
// Image
// ──────────────────────────────────────────────────────────

function ImageMedia({
  url,
  caption,
  compact,
}: {
  url?: string;
  caption?: string;
  compact: boolean;
}) {
  const t = useTranslations('chat.media');
  const [lightbox, setLightbox] = useState(false);
  const [errored, setErrored] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const maxWidth = compact ? 280 : 400;

  if (!url || errored) return <FallbackCard icon={ImageOff} label={t('imageUnavailable')} />;

  return (
    <>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setLightbox(true)}
          className="relative overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-95"
          style={{ maxWidth }}
        >
          {!loaded && (
            <div
              className="aspect-[4/3] w-full animate-pulse bg-muted"
              style={{ maxWidth }}
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={caption ?? ''}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
            className={cn(
              'block h-auto w-full object-cover transition-opacity',
              loaded ? 'opacity-100' : 'opacity-0 absolute inset-0',
            )}
            style={{ maxWidth }}
          />
        </button>
        {caption && (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{caption}</p>
        )}
      </div>

      <Dialog open={lightbox} onOpenChange={setLightbox}>
        <DialogContent className="max-w-5xl border-0 bg-transparent p-0 shadow-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={caption ?? ''}
            className="max-h-[85vh] w-auto rounded-md"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function StickerMedia({ url }: { url?: string }) {
  const t = useTranslations('chat.media');
  if (!url) return <FallbackCard icon={ImageOff} label={t('stickerUnavailable')} />;
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={url}
      alt="sticker"
      className="h-[120px] w-[120px] object-contain"
      loading="lazy"
    />
  );
}

// ──────────────────────────────────────────────────────────
// Audio — player custom
// ──────────────────────────────────────────────────────────

function AudioMedia({
  url,
  duration: durationProp,
  compact,
}: {
  url?: string;
  duration?: number;
  compact: boolean;
}) {
  const t = useTranslations('chat.media');
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(durationProp ?? 0);
  const width = compact ? 260 : 320;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrent(audio.currentTime);
    const onMeta = () => setTotal(audio.duration || 0);
    const onEnd = () => setPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
    };
  }, [url]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void audio.play().then(() => setPlaying(true));
    }
  }

  if (!url) {
    return (
      <span className="text-sm italic text-muted-foreground">{t('audioNoUrl')}</span>
    );
  }

  const progress = total > 0 ? (current / total) * 100 : 0;

  // Waveform fake — 24 barras de altura variável (deterministic via index)
  const bars = Array.from({ length: 24 }, (_, i) => 30 + ((i * 13) % 70));

  return (
    <div
      className="flex items-center gap-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-2"
      style={{ width }}
    >
      <button
        type="button"
        onClick={toggle}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-white shadow-sm transition-transform hover:scale-105"
        aria-label={playing ? t('audioPause') : t('audioPlay')}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>

      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <div className="flex h-6 items-end gap-0.5">
          {bars.map((h, i) => {
            const barProgress = ((i + 1) / bars.length) * 100;
            const filled = barProgress <= progress;
            return (
              <span
                key={i}
                className={cn(
                  'block w-[3px] rounded-full transition-colors',
                  filled ? 'bg-cyan-500' : 'bg-cyan-500/30',
                )}
                style={{ height: `${h}%` }}
              />
            );
          })}
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {formatTime(current)} / {formatTime(total)}
        </span>
      </div>

      <audio ref={audioRef} src={url} preload="metadata" className="hidden" />
    </div>
  );
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ──────────────────────────────────────────────────────────
// Video
// ──────────────────────────────────────────────────────────

function VideoMedia({ url, compact }: { url?: string; compact: boolean }) {
  const t = useTranslations('chat.media');
  const [open, setOpen] = useState(false);
  const maxWidth = compact ? 280 : 400;

  if (!url) return <FallbackCard icon={ImageOff} label={t('videoUnavailable')} />;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative overflow-hidden rounded-md border border-border bg-black"
        style={{ maxWidth }}
      >
        <video
          src={url}
          preload="metadata"
          className="block h-auto w-full"
          style={{ maxWidth }}
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover:bg-black/40">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
            <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
          </span>
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl border-0 bg-transparent p-0 shadow-none">
          <video src={url} controls autoPlay className="max-h-[85vh] w-full rounded-md" />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ──────────────────────────────────────────────────────────
// Document
// ──────────────────────────────────────────────────────────

function DocumentMedia({
  url,
  filename,
  size,
  compact,
}: {
  url?: string;
  filename?: string;
  size?: number;
  compact: boolean;
}) {
  const t = useTranslations('chat.media');
  if (!url) return <FallbackCard icon={File} label={t('documentUnavailable')} />;

  const ext = filename?.split('.').pop()?.toLowerCase() ?? '';
  const { Icon, color } = pickFileIcon(ext);
  const width = compact ? 240 : 300;

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border bg-card p-2"
      style={{ width }}
    >
      <span
        className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', color)}
      >
        <Icon className="h-4 w-4 text-white" />
      </span>
      <div className="flex flex-1 flex-col min-w-0">
        <span className="truncate text-sm font-medium">{filename ?? t('documentFallback')}</span>
        <span className="text-[10px] text-muted-foreground">
          {size ? formatSize(size) : ext.toUpperCase() || t('fileFallback')}
        </span>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={t('downloadAria')}
      >
        <Download className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

function pickFileIcon(ext: string): { Icon: typeof File; color: string } {
  if (ext === 'pdf') return { Icon: FileText, color: 'bg-red-500' };
  if (['xlsx', 'xls', 'csv'].includes(ext)) return { Icon: FileSpreadsheet, color: 'bg-green-600' };
  if (['doc', 'docx'].includes(ext)) return { Icon: FileText, color: 'bg-blue-500' };
  return { Icon: File, color: 'bg-muted-foreground' };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ──────────────────────────────────────────────────────────
// Location
// ──────────────────────────────────────────────────────────

function LocationMedia({
  lat,
  lng,
  name,
  address,
  compact,
}: {
  lat?: number;
  lng?: number;
  name?: string;
  address?: string;
  compact: boolean;
}) {
  const t = useTranslations('chat.media');
  const width = compact ? 260 : 320;
  const mapsUrl =
    lat !== undefined && lng !== undefined
      ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
      : address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
        : null;

  return (
    <div
      className="flex flex-col overflow-hidden rounded-md border border-border bg-card"
      style={{ width }}
    >
      <div className="flex h-24 items-center justify-center bg-gradient-to-br from-blue-500/10 to-cyan-500/10">
        <MapPin className="h-8 w-8 text-cyan-500" />
      </div>
      <div className="flex flex-col gap-1 p-2">
        {name && <span className="truncate text-sm font-medium">{name}</span>}
        {address && (
          <span className="truncate text-[11px] text-muted-foreground">{address}</span>
        )}
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 self-start rounded-md bg-cyan-500/10 px-2 py-1 text-[11px] font-medium text-cyan-600 transition-colors hover:bg-cyan-500/20 dark:text-cyan-400"
          >
            <ExternalLink className="h-3 w-3" />
            {t('openMaps')}
          </a>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Contact
// ──────────────────────────────────────────────────────────

function ContactMedia({ name, phone }: { name?: string; phone?: string }) {
  const t = useTranslations('chat.media');
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <UserIcon className="h-4 w-4" />
      </span>
      <div className="flex flex-1 flex-col min-w-0">
        <span className="truncate text-sm font-medium">{name ?? t('sharedContact')}</span>
        {phone && (
          <span className="truncate text-[11px] text-muted-foreground">{phone}</span>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Fallback card
// ──────────────────────────────────────────────────────────

function FallbackCard({
  icon: Icon,
  label,
}: {
  icon: typeof File;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Auto-detect helpers (compat com mensagens antigas sem metadata)
// ──────────────────────────────────────────────────────────

const IMG_RE = /\.(jpe?g|png|gif|webp|bmp|svg)(\?[^\s]*)?$/i;
const AUDIO_RE = /\.(mp3|ogg|wav|m4a|opus)(\?[^\s]*)?$/i;
const VIDEO_RE = /\.(mp4|webm|mov|avi)(\?[^\s]*)?$/i;
const URL_RE = /(https?:\/\/[^\s]+)/i;

function detectFromText(text: string): string {
  const url = extractUrl(text);
  if (!url) return 'text';
  if (IMG_RE.test(url)) return 'image';
  if (AUDIO_RE.test(url)) return 'audio';
  if (VIDEO_RE.test(url)) return 'video';
  return 'text';
}

function extractUrl(text: string): string | undefined {
  const m = URL_RE.exec(text);
  return m ? m[1] : undefined;
}
