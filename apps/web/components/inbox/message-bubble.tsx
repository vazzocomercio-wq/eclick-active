'use client';

import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Lock,
  Sparkles,
} from 'lucide-react';
import type { Message, MessageDeliveryStatus } from '@eclick-active/shared';
import { MessageMedia } from '@/components/chat/message-media';
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
  // Toda renderização rica delegada a MessageMedia, que decide o tipo via
  // content_type / metadata.type / auto-detect a partir de URL no texto.
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
