'use client';

import Link from 'next/link';
import { Flame, MessageCircle } from 'lucide-react';
import type { HotLeadItem } from '@/lib/api/dashboard';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { TemperatureBadge } from '@/components/contacts/temperature-badge';
import { getInitials, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface HotLeadsCardProps {
  items: HotLeadItem[];
  loading?: boolean;
}

export function HotLeadsCard({ items, loading }: HotLeadsCardProps) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <header className="flex items-center gap-2">
        <Flame className="h-4 w-4 text-orange-400" />
        <h2 className="text-sm font-semibold">Leads mais quentes</h2>
      </header>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyHotLeads />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item, idx) => (
            <li
              key={item.id}
              className="animate-in fade-in slide-in-from-left-1"
              style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'backwards' }}
            >
              <HotLeadRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HotLeadRow({ item }: { item: HotLeadItem }) {
  const href = item.conversation_id
    ? `/conversas?conversation=${item.conversation_id}`
    : `/contatos/${item.id}`;
  const displayName = item.name ?? 'Sem nome';

  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-3 rounded-lg p-2 transition-colors',
        'hover:bg-accent/5',
      )}
    >
      <Avatar className="h-9 w-9 shrink-0">
        {item.avatar_url ? <AvatarImage src={item.avatar_url} alt={displayName} /> : null}
        <AvatarFallback className="text-xs">{getInitials(item.name)}</AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{displayName}</span>
          <TemperatureBadge temperature={item.temperature} className="shrink-0 text-[10px]" />
        </div>
        <span className="truncate text-xs text-muted-foreground">
          {item.last_message_preview ?? 'Sem mensagens'}
          {item.last_message_at && ` · ${formatRelativeTime(item.last_message_at)}`}
        </span>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-[11px] font-semibold tabular-nums text-accent">{item.score}</span>
        <MessageCircle className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
      </div>
    </Link>
  );
}

function EmptyHotLeads() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-center">
      <Flame className="h-6 w-6 text-muted-foreground" />
      <p className="text-xs font-medium">Nenhum lead quente ainda</p>
      <Link
        href="/conversas"
        className="text-[11px] font-medium text-primary hover:underline"
      >
        Conecte seu WhatsApp →
      </Link>
    </div>
  );
}
