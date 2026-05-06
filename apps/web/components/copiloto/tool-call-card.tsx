'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Globe,
  Headphones,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  MessageCircle,
  Package,
  PieChart,
  Search,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ToolCallRecord } from '@/lib/api/copilot';
import { cn } from '@/lib/utils';

interface ToolCallCardProps {
  call: ToolCallRecord;
}

const FALLBACK_VISUAL: { icon: LucideIcon; color: string } = {
  icon: Wrench,
  color: 'text-muted-foreground',
};

/**
 * Renderiza um tool_call como chip/card abaixo da resposta. Mostra ícone,
 * resumo e — se a tool criou um recurso — link direto pra ele.
 *
 * Tolerante a tools desconhecidas: cai no FALLBACK_VISUAL pra não crashar
 * caso o backend retorne uma tool sem mapeamento (ex: tool nova não
 * registrada aqui ainda).
 */
export function ToolCallCard({ call }: ToolCallCardProps) {
  const v = TOOL_VISUAL[call.tool] ?? FALLBACK_VISUAL;
  const Icon = v.icon;

  const href = call.resource_kind === 'task'
    ? `/tarefas?task=${call.resource_id}`
    : call.resource_kind === 'deal'
      ? `/funis?deal=${call.resource_id}`
      : null;

  const inner = (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-1.5 text-xs',
        href && 'transition-colors hover:border-primary/30 hover:bg-accent/5',
      )}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', v.color)} />
      <span className="flex-1 truncate">{call.summary}</span>
      {href && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
    </div>
  );

  if (href) {
    return <Link href={href}>{inner}</Link>;
  }
  return inner;
}

const TOOL_VISUAL: Record<ToolCallRecord['tool'], { icon: LucideIcon; color: string }> = {
  search_contacts: { icon: Users, color: 'text-blue-400' },
  list_deals: { icon: TrendingUp, color: 'text-accent' },
  get_pipeline_summary: { icon: PieChart, color: 'text-purple-400' },
  list_conversations: { icon: MessageCircle, color: 'text-cyan-400' },
  list_tasks: { icon: ListChecks, color: 'text-yellow-400' },
  get_agent_stats: { icon: Search, color: 'text-orange-400' },
  create_task: { icon: CheckCircle2, color: 'text-emerald-400' },
  create_deal: { icon: Target, color: 'text-emerald-400' },
  search_knowledge: { icon: BookOpen, color: 'text-violet-400' },
  search_live_sources: { icon: Globe, color: 'text-cyan-400' },
  check_available_slots: { icon: CalendarClock, color: 'text-emerald-400' },
  schedule_appointment: { icon: CalendarPlus, color: 'text-emerald-400' },
  send_scheduling_link: { icon: Send, color: 'text-blue-400' },
  list_sac_tickets: { icon: Headphones, color: 'text-cyan-400' },
  get_sac_dashboard: { icon: LayoutDashboard, color: 'text-cyan-400' },
  get_sac_performance: { icon: Sparkles, color: 'text-cyan-400' },
  check_order_status: { icon: Package, color: 'text-orange-400' },
  generate_social_content: { icon: Megaphone, color: 'text-pink-400' },
  list_pending_social_content: { icon: Megaphone, color: 'text-amber-400' },
  get_social_dashboard: { icon: Megaphone, color: 'text-pink-400' },
  schedule_social_content: { icon: Megaphone, color: 'text-blue-400' },
};
