'use client';

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { MessageCircle } from 'lucide-react';
import type { ChannelReport } from '@/lib/api/reports';
import { cn } from '@/lib/utils';

interface ChannelsTabProps {
  data: ChannelReport | null;
  loading: boolean;
}

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: '#22C55E',
  instagram: '#E1306C',
  messenger: '#0084FF',
  telegram: '#229ED9',
  email: '#F59E0B',
  webchat: '#8B5CF6',
  tiktok: '#FF0050',
  mercadolivre: '#FFE600',
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  telegram: 'Telegram',
  email: 'Email',
  webchat: 'WebChat',
  tiktok: 'TikTok',
  mercadolivre: 'Mercado Livre',
};

export function ChannelsTab({ data, loading }: ChannelsTabProps) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (data.channels.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
        Nenhuma conversa registrada no período.
      </div>
    );
  }

  const pieData = data.channels.map((c) => ({
    name: CHANNEL_LABELS[c.channel_type] ?? c.channel_type,
    value: c.conversations,
    color: CHANNEL_COLORS[c.channel_type] ?? '#6B7280',
  }));

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {/* Cards de canais */}
      <section className="flex flex-col gap-3">
        {data.channels.map((c, idx) => {
          const color = CHANNEL_COLORS[c.channel_type] ?? '#6B7280';
          const label = CHANNEL_LABELS[c.channel_type] ?? c.channel_type;
          const pctOfTotal =
            data.total_conversations > 0
              ? (c.conversations / data.total_conversations) * 100
              : 0;

          return (
            <article
              key={c.channel_type}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 animate-in fade-in slide-in-from-left-1"
              style={{ animationDelay: `${idx * 30}ms`, animationFillMode: 'backwards' }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: `${color}20`, color }}
                >
                  <MessageCircle className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold">{label}</span>
                <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                  {pctOfTotal.toFixed(0)}% do total
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <Stat label="Conversas" value={c.conversations.toLocaleString('pt-BR')} />
                <Stat label="Leads" value={c.leads.toLocaleString('pt-BR')} />
                <Stat
                  label="Conversão"
                  value={`${c.conversion_rate}%`}
                  highlight={c.conversion_rate}
                />
              </div>
            </article>
          );
        })}
      </section>

      {/* Donut chart */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Distribuição de conversas</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {data.total_conversations.toLocaleString('pt-BR')} total
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={2}
              >
                {pieData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const p = payload[0];
                  if (!p) return null;
                  return (
                    <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-md">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-muted-foreground">
                        {String(p.value)} conversas
                      </p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>

          {/* Legenda */}
          <div className="flex flex-wrap gap-2">
            {pieData.map((p) => (
              <div key={p.name} className="flex items-center gap-1.5 text-[11px]">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <span className="text-muted-foreground">{p.name}</span>
                <span className="font-semibold tabular-nums">{p.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: number;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'text-base font-semibold tabular-nums',
          highlight !== undefined && highlight >= 20 && 'text-accent',
          highlight !== undefined && highlight < 5 && 'text-orange-400',
        )}
      >
        {value}
      </span>
    </div>
  );
}
