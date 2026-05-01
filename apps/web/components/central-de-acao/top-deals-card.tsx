'use client';

import Link from 'next/link';
import { Target, TrendingUp } from 'lucide-react';
import type { TopDealItem } from '@/lib/api/dashboard';
import { cn } from '@/lib/utils';

interface TopDealsCardProps {
  items: TopDealItem[];
  loading?: boolean;
}

export function TopDealsCard({ items, loading }: TopDealsCardProps) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <header className="flex items-center gap-2">
        <Target className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold">Próximos de fechar</h2>
      </header>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyTopDeals />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item, idx) => (
            <li
              key={item.id}
              className="animate-in fade-in slide-in-from-right-1"
              style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'backwards' }}
            >
              <TopDealRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TopDealRow({ item }: { item: TopDealItem }) {
  const probability = item.ai_close_probability ?? 0;

  return (
    <Link
      href={`/funis?deal=${item.id}`}
      className={cn(
        'group flex flex-col gap-1.5 rounded-lg p-2.5 transition-colors',
        'hover:bg-accent/5',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{item.title}</span>
          <span className="truncate text-[11px] text-muted-foreground">
            {item.contact_name ?? 'Sem contato'} · {item.stage_name}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-sm font-semibold tabular-nums text-accent">
            {formatBRL(item.value)}
          </span>
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-muted-foreground">
            <TrendingUp className="h-3 w-3" />
            {probability}%
          </span>
        </div>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-gradient-to-r from-accent to-primary transition-all"
          style={{ width: `${probability}%` }}
        />
      </div>
    </Link>
  );
}

function EmptyTopDeals() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-center">
      <Target className="h-6 w-6 text-muted-foreground" />
      <p className="text-xs font-medium">Nenhum negócio com probabilidade ainda</p>
      <Link href="/funis" className="text-[11px] font-medium text-primary hover:underline">
        Crie seu primeiro negócio →
      </Link>
    </div>
  );
}

function formatBRL(n: number): string {
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`;
  if (n >= 10_000) return `R$ ${(n / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}
