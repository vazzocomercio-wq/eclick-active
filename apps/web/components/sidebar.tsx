'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Bot,
  CheckSquare,
  ChevronLeft,
  Kanban,
  LayoutDashboard,
  MessageSquare,
  Settings,
  UserCog,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  badge?: number;
  tag?: string;
}

const PRIMARY_NAV: NavItem[] = [
  { href: '/central-de-acao', icon: LayoutDashboard, label: 'Central de Ação' },
  { href: '/conversas', icon: MessageSquare, label: 'Conversas', badge: 12 },
  { href: '/funis', icon: Kanban, label: 'Funis' },
  { href: '/contatos', icon: Users, label: 'Contatos' },
  { href: '/tarefas', icon: CheckSquare, label: 'Tarefas' },
  { href: '/copiloto', icon: Bot, label: 'Copiloto IA', tag: 'AI' },
  { href: '/automacoes', icon: Zap, label: 'Automações' },
  { href: '/conhecimento', icon: BookOpen, label: 'Conhecimento' },
  { href: '/relatorios', icon: BarChart3, label: 'Relatórios' },
  { href: '/equipe', icon: UserCog, label: 'Equipe' },
];

const FOOTER_NAV: NavItem[] = [
  { href: '/configuracoes', icon: Settings, label: 'Configurações' },
];

const COLLAPSED_KEY = 'sidebar:collapsed';

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY);
      if (saved === '1') setCollapsed(true);
    } catch {
      /* ignore */
    }
    setMounted(true);
  }, []);

  function toggleCollapse() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Evita mismatch de hidratação: até montar, renderiza expandido
  const isCollapsed = mounted && collapsed;

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r border-border bg-background transition-[width] duration-200',
        isCollapsed ? 'w-16' : 'w-64',
      )}
      aria-label="Navegação principal"
    >
      {/* Logo + collapse toggle */}
      <div className="flex h-16 items-center justify-between border-b border-border px-4">
        {!isCollapsed && (
          <Link href="/central-de-acao" className="text-lg font-semibold tracking-tight">
            e-Click <span className="text-primary">Active</span>
          </Link>
        )}
        <button
          type="button"
          onClick={toggleCollapse}
          aria-label={isCollapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground"
        >
          <ChevronLeft
            className={cn('h-4 w-4 transition-transform', isCollapsed && 'rotate-180')}
          />
        </button>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto py-3">
        <ul className="flex flex-col gap-0.5 px-2">
          {PRIMARY_NAV.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              collapsed={isCollapsed}
            />
          ))}
        </ul>

        <div className="mx-3 my-3 border-t border-border" />

        <ul className="flex flex-col gap-0.5 px-2">
          {FOOTER_NAV.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              collapsed={isCollapsed}
            />
          ))}
        </ul>
      </nav>

      {/* Theme toggle */}
      <div
        className={cn(
          'border-t border-border p-3',
          isCollapsed ? 'flex justify-center' : '',
        )}
      >
        <ThemeToggle collapsed={isCollapsed} />
      </div>
    </aside>
  );
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(href + '/');
}

interface NavLinkProps {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}

function NavLink({ item, active, collapsed }: NavLinkProps) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        title={collapsed ? item.label : undefined}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          'border-l-2 border-transparent',
          active
            ? 'border-primary bg-card text-foreground'
            : 'text-muted-foreground hover:bg-card/50 hover:text-foreground',
          collapsed && 'justify-center px-2',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/15 px-1.5 text-xs font-medium text-primary">
                {item.badge}
              </span>
            )}
            {item.tag && (
              <span className="ml-auto rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                {item.tag}
              </span>
            )}
          </>
        )}
      </Link>
    </li>
  );
}
