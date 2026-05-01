'use client';

import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Lock,
  Sparkles,
} from 'lucide-react';
import type { Message, MessageDeliveryStatus } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound';
  const isBot = message.sender_type === 'bot';
  const isInternalNote = message.is_internal_note;
  const time = new Date(message.created_at).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={cn('flex w-full', isOutbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'group max-w-[75%] rounded-lg px-3 py-2 shadow-sm',
          isInternalNote
            ? 'border border-yellow-500/40 bg-yellow-500/10 text-foreground'
            : isOutbound
              ? 'bg-primary/15 text-foreground'
              : 'bg-card text-foreground',
        )}
      >
        {(isBot || isInternalNote) && (
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
            {isBot && (
              <span className="inline-flex items-center gap-1 rounded-sm bg-primary/20 px-1.5 py-0.5 text-primary">
                <Sparkles className="h-3 w-3" /> IA
              </span>
            )}
            {isInternalNote && (
              <span className="inline-flex items-center gap-1 text-yellow-500">
                <Lock className="h-3 w-3" /> Nota interna
              </span>
            )}
          </div>
        )}

        <MessageContent message={message} />

        <div
          className={cn(
            'mt-1 flex items-center justify-end gap-1 text-[10px]',
            isOutbound ? 'text-foreground/60' : 'text-muted-foreground',
          )}
        >
          <time dateTime={message.created_at}>{time}</time>
          {isOutbound && <DeliveryStatus status={message.status} />}
        </div>
      </div>
    </div>
  );
}

function MessageContent({ message }: { message: Message }) {
  const c = message.content as Record<string, unknown> | null;

  switch (message.content_type) {
    case 'text':
      return (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {typeof c?.body === 'string' ? c.body : message.plain_text}
        </p>
      );

    case 'image':
      return (
        <div className="flex flex-col gap-1">
          {typeof c?.url === 'string' && (
            <img
              src={c.url as string}
              alt=""
              className="max-h-64 max-w-full rounded-md object-cover"
              loading="lazy"
            />
          )}
          {typeof c?.caption === 'string' && (
            <p className="whitespace-pre-wrap text-sm">{c.caption}</p>
          )}
        </div>
      );

    case 'audio':
      return typeof c?.url === 'string' ? (
        <audio src={c.url as string} controls className="max-w-full" />
      ) : (
        <span className="text-sm italic text-muted-foreground">áudio sem URL</span>
      );

    case 'video':
      return typeof c?.url === 'string' ? (
        <video src={c.url as string} controls className="max-h-64 max-w-full rounded-md" />
      ) : null;

    case 'document':
      return typeof c?.url === 'string' ? (
        <a
          href={c.url as string}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-2 py-1.5 text-xs hover:bg-background"
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {typeof c?.filename === 'string' ? c.filename : 'documento'}
          </span>
        </a>
      ) : null;

    case 'location':
      return (
        <p className="text-sm italic text-muted-foreground">
          📍 {typeof c?.name === 'string' ? c.name : 'localização'}
        </p>
      );

    case 'system':
      return (
        <p className="text-xs italic text-muted-foreground">
          {typeof c?.event === 'string' ? c.event : 'evento do sistema'}
        </p>
      );

    default:
      return (
        <p className="text-xs italic text-muted-foreground">
          [{message.content_type}] {message.plain_text ?? '—'}
        </p>
      );
  }
}

function DeliveryStatus({ status }: { status: MessageDeliveryStatus }) {
  switch (status) {
    case 'pending':
      return <Clock className="h-3 w-3" />;
    case 'sent':
      return <Check className="h-3 w-3" />;
    case 'delivered':
      return <CheckCheck className="h-3 w-3" />;
    case 'read':
      return <CheckCheck className="h-3 w-3 text-blue-500" />;
    case 'failed':
      return <AlertCircle className="h-3 w-3 text-destructive" />;
    default:
      return null;
  }
}
