'use client';

import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Lock,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Message, MessageDeliveryStatus } from '@eclick-active/shared';
import type { ConversationAttachment } from '@/lib/api/attachments';
import { AttachmentCard } from '@/components/chat/attachment-card';
import { MessageMedia } from '@/components/chat/message-media';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: Message;
  /** Attachments dessa mensagem (vindos do Storage com signed URL + summary IA). */
  attachments?: ConversationAttachment[];
  /** Reenvia uma mensagem outbound que falhou (status 'failed'). */
  onRetry?: (messageId: string) => void;
}

export function MessageBubble({ message, attachments, onRetry }: MessageBubbleProps) {
  const t = useTranslations('inbox.messageBubble');
  const isOutbound = message.direction === 'outbound';
  const isFailed = message.status === 'failed';
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
                <Sparkles className="h-3 w-3" /> {t('aiLabel')}
              </span>
            )}
            {isInternalNote && (
              <span className="inline-flex items-center gap-1 text-yellow-500">
                <Lock className="h-3 w-3" /> {t('internalNote')}
              </span>
            )}
          </div>
        )}

        <MessageContent message={message} attachments={attachments} />

        <div
          className={cn(
            'mt-1 flex items-center justify-end gap-1 text-[10px]',
            isOutbound ? 'text-foreground/60' : 'text-muted-foreground',
          )}
        >
          <time dateTime={message.created_at}>{time}</time>
          {isOutbound && <DeliveryStatus status={message.status} />}
        </div>

        {isOutbound && isFailed && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(message.id)}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-destructive hover:underline"
          >
            <RotateCcw className="h-3 w-3" />
            {t('retry')}
          </button>
        )}
      </div>
    </div>
  );
}

function MessageContent({
  message,
  attachments,
}: {
  message: Message;
  attachments?: ConversationAttachment[];
}) {
  // Quando a mensagem tem attachments processados (Sub-fase 2.B), renderiza
  // mídia rica + summary IA via AttachmentCard. Mantém o texto da msg como
  // legenda quando houver. Se não tem attachment, fallback pra MessageMedia
  // (auto-detect a partir de content_type / metadata.type / URL no texto).
  if (attachments && attachments.length > 0) {
    const caption =
      ((message.content as Record<string, unknown> | null)?.body as string | undefined) ??
      message.plain_text ??
      '';
    return (
      <div className="flex flex-col gap-1.5">
        {attachments.map((a) => (
          <AttachmentCard key={a.id} attachment={a} />
        ))}
        {caption && caption.trim() && (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {caption}
          </p>
        )}
      </div>
    );
  }

  return <MessageMedia message={message} />;
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
