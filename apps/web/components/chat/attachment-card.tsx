'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FileSpreadsheet,
  FileText,
  ImageOff,
  Loader2,
  Mic,
  Quote,
  Sparkles,
  Video as VideoIcon,
} from 'lucide-react';
import type { ConversationAttachment } from '@/lib/api/attachments';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface AttachmentCardProps {
  attachment: ConversationAttachment;
  /** Compact reduz tamanhos pra caber em drawers laterais. */
  compact?: boolean;
}

/**
 * Renderiza um attachment processado pelo Concierge (imagem, audio,
 * vídeo, documento) com signed URL do Storage + chip de summary IA
 * abaixo. Clicável pra abrir lightbox/dialog quando aplicável.
 */
export function AttachmentCard({ attachment, compact = false }: AttachmentCardProps) {
  // Transcript fica em ai_extracted.transcript quando media_type=audio.
  const extracted = attachment.ai_extracted as
    | { type?: string; transcript?: string }
    | null;
  const transcript =
    attachment.media_type === 'audio' && typeof extracted?.transcript === 'string'
      ? extracted.transcript
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <MediaBlock attachment={attachment} compact={compact} />
      {attachment.ai_summary && (
        <div className="inline-flex items-start gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/5 px-2 py-1.5 text-[11px] leading-tight text-cyan-700 dark:text-cyan-300">
          <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-3">{attachment.ai_summary}</span>
        </div>
      )}
      {transcript && transcript.trim() && (
        <TranscriptToggle transcript={transcript} />
      )}
      {!attachment.ai_summary && attachment.url && (
        <span className="inline-flex items-center gap-1 text-[10px] italic text-muted-foreground">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          IA está analisando…
        </span>
      )}
    </div>
  );
}

function TranscriptToggle({ transcript }: { transcript: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border/60 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[10px] text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <Quote className="h-3 w-3 shrink-0" />
        <span className="font-medium uppercase tracking-wider">Transcrição</span>
      </button>
      {open && (
        <div className="border-t border-border/60 px-2 py-1.5 text-[11px] leading-relaxed text-foreground/80">
          {transcript}
        </div>
      )}
    </div>
  );
}

function MediaBlock({
  attachment,
  compact,
}: {
  attachment: ConversationAttachment;
  compact: boolean;
}) {
  const { url, media_type, mime_type, file_name, file_size_bytes } = attachment;

  if (!url) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <ImageOff className="h-4 w-4" />
        <span>Mídia indisponível</span>
      </div>
    );
  }

  const maxWidth = compact ? 280 : 400;

  switch (media_type) {
    case 'image':
      return <ImageBlock url={url} maxWidth={maxWidth} />;
    case 'video':
      return <VideoBlock url={url} maxWidth={maxWidth} />;
    case 'audio':
      return <AudioBlock url={url} compact={compact} />;
    case 'document':
      return (
        <DocumentBlock
          url={url}
          fileName={file_name}
          mimeType={mime_type}
          fileSize={file_size_bytes}
          compact={compact}
        />
      );
    default:
      return null;
  }
}

function ImageBlock({ url, maxWidth }: { url: string; maxWidth: number }) {
  const [open, setOpen] = useState(false);
  const [errored, setErrored] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (errored) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <ImageOff className="h-4 w-4" />
        <span>Erro ao carregar imagem</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
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
          alt=""
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl border-0 bg-transparent p-0 shadow-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="max-h-[85vh] w-auto rounded-md" />
        </DialogContent>
      </Dialog>
    </>
  );
}

function VideoBlock({ url, maxWidth }: { url: string; maxWidth: number }) {
  return (
    <video
      src={url}
      controls
      preload="metadata"
      className="block h-auto w-full rounded-md border border-border"
      style={{ maxWidth }}
    >
      <track kind="captions" />
    </video>
  );
}

function AudioBlock({ url, compact }: { url: string; compact: boolean }) {
  return (
    <div
      className="flex items-center gap-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-2"
      style={{ width: compact ? 260 : 320 }}
    >
      <Mic className="h-4 w-4 shrink-0 text-cyan-500" />
      <audio src={url} controls className="h-7 flex-1" />
    </div>
  );
}

function DocumentBlock({
  url,
  fileName,
  mimeType,
  fileSize,
  compact,
}: {
  url: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  compact: boolean;
}) {
  const ext = fileName?.split('.').pop()?.toLowerCase() ?? '';
  const { Icon, color } = pickFileIcon(ext, mimeType);
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
        <span className="truncate text-sm font-medium">{fileName ?? 'documento'}</span>
        <span className="text-[10px] text-muted-foreground">
          {fileSize ? formatSize(fileSize) : ext.toUpperCase() || 'Arquivo'}
        </span>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        download={fileName ?? undefined}
        className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Baixar documento"
      >
        <Download className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

function pickFileIcon(
  ext: string,
  mime: string | null,
): { Icon: typeof File; color: string } {
  if (ext === 'pdf' || mime?.includes('pdf'))
    return { Icon: FileText, color: 'bg-red-500' };
  if (['xlsx', 'xls', 'csv'].includes(ext))
    return { Icon: FileSpreadsheet, color: 'bg-green-600' };
  if (['doc', 'docx'].includes(ext)) return { Icon: FileText, color: 'bg-blue-500' };
  if (mime?.startsWith('video/')) return { Icon: VideoIcon, color: 'bg-purple-500' };
  return { Icon: File, color: 'bg-muted-foreground' };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
