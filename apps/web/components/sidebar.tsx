'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Bot,
  Calendar,
  CalendarClock,
  CheckSquare,
  ChevronLeft,
  FileText,
  Headphones,
  Kanban,
  Layout,
  LayoutDashboard,
  Building2,
  Megaphone,
  MessageSquare,
  Settings,
  UserCog,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';
import { useUnreadCount } from '@/hooks/use-unread-count';
import { useSacCriticalCount } from '@/hooks/use-sac';
import { useSocialPendingCount } from '@/hooks/use-social';

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  badge?: number;
  tag?: string;
}

const PRIMARY_NAV: NavItem[] = [
  { href: '/central-de-acao', icon: LayoutDashboard, label: 'Central de Ação' },
  // O badge de Conversas é injetado dinamicamente via useUnreadCount no render
  { href: '/conversas', icon: MessageSquare, label: 'Conversas' },
  { href: '/funis', icon: Kanban, label: 'Funis' },
  { href: '/contatos', icon: Users, label: 'Contatos' },
  { href: '/tarefas', icon: CheckSquare, label: 'Tarefas' },
  // O badge de SAC é injetado dinamicamente via useSacCriticalCount no render
  { href: '/sac', icon: Headphones, label: 'SAC', tag: 'AI' },
  { href: '/calendario', icon: Calendar, label: 'Calendário' },
  { href: '/agenda', icon: CalendarClock, label: 'Agenda', tag: 'AI' },
  { href: '/copiloto', icon: Bot, label: 'Copiloto IA', tag: 'AI' },
  { href: '/automacoes', icon: Zap, label: 'Automações' },
  { href: '/formularios', icon: FileText, label: 'Formulários' },
  { href: '/paginas', icon: Layout, label: 'Páginas', tag: 'AI' },
  // Social AI badge é injetado via useSocialPendingCount
  { href: '/social', icon: Megaphone, label: 'Social AI', tag: 'AI' },
  { href: '/conhecimento', icon: BookOpen, label: 'Conhecimento' },
  { href: '/relatorios', icon: BarChart3, label: 'Relatórios' },
  { href: '/agencia', icon: Building2, label: 'Agência' },
  { href: '/equipe', icon: UserCog, label: 'Equipe' },
];

const FOOTER_NAV: NavItem[] = [
  { href: '/configuracoes', icon: Settings, label: 'Configurações' },
];

const COLLAPSED_KEY = 'sidebar:collapsed';

interface SidebarProps {
  /** Quando true, em mobile a sidebar fica visível (translate-x-0). */
  mobileOpen?: boolean;
  /** Callback pra fechar em mobile (chamado ao clicar item, ESC, ou backdrop). */
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps = {}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const unreadCount = useUnreadCount();
  const sacCriticalCount = useSacCriticalCount();
  const socialPendingCount = useSocialPendingCount();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY);
      if (saved === '1') setCollapsed(true);
    } catch {
      /* ignore */
    }
    setMounted(true);
  }, []);

  // Auto-close em mobile quando rota muda (clicou num link)
  useEffect(() => {
    if (mobileOpen && onMobileClose) {
      onMobileClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // ESC fecha em mobile
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && onMobileClose) onMobileClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);

  // Travar scroll do body quando drawer mobile aberto
  useEffect(() => {
    if (!mobileOpen) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = orig;
    };
  }, [mobileOpen]);

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
  // Em mobile (drawer aberto), nunca colapsa.
  const isCollapsed = mounted && collapsed && !mobileOpen;

  return (
    <>
      {/* Backdrop (mobile drawer aberto) */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden',
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        aria-hidden="true"
        onClick={onMobileClose}
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-screen flex-col border-r border-border bg-background transition-transform duration-200',
          // Desktop: comportamento normal (estático, largura controlada)
          'lg:static lg:translate-x-0 lg:transition-[width]',
          isCollapsed ? 'lg:w-16' : 'lg:w-64',
          // Mobile: translate-x off-canvas
          'w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
        aria-label="Navegação principal"
      >
        {/* Logo + collapse/close toggle */}
        <div
          className={cn(
            'flex items-center border-b border-border',
            isCollapsed ? 'h-16 justify-center px-2' : 'h-20 justify-between px-4',
          )}
        >
          {isCollapsed ? (
            // Quando colapsado, o ícone é o próprio botão de expandir
            <button
              type="button"
              onClick={toggleCollapse}
              aria-label="Expandir sidebar"
              className="flex h-12 w-12 items-center justify-center rounded-md hover:bg-card"
            >
              <Image
                src="/logo-active.svg"
                alt="e-Click Active"
                width={48}
                height={48}
                priority
                className="h-10 w-10"
              />
            </button>
          ) : (
            <Link
              href="/central-de-acao"
              className="flex items-center"
              aria-label="e-Click Active"
              onClick={onMobileClose}
            >
              <Image
                src="/logo-icon.svg"
                alt="e-Click Active"
                width={280}
                height={112}
                priority
                className="h-14 w-auto"
              />
            </Link>
          )}

          {/* Botão collapse (desktop) — escondido em mobile pra não confundir com close */}
          {!isCollapsed && (
            <button
              type="button"
              onClick={toggleCollapse}
              aria-label="Colapsar sidebar"
              className="hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground lg:flex"
            >
              <ChevronLeft
                className={cn('h-4 w-4 transition-transform', isCollapsed && 'rotate-180')}
              />
            </button>
          )}

          {/* Botão fechar (mobile) */}
          {mobileOpen && (
            <button
              type="button"
              onClick={onMobileClose}
              aria-label="Fechar menu"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Primary nav */}
        <nav className="flex-1 overflow-y-auto py-2 scrollbar-auto-hide">
          <ul className="flex flex-col gap-0.5 px-2">
            {PRIMARY_NAV.map((item) => {
              // Injeta badges dinâmicos: /conversas (não-lidas) e /sac (críticos)
              let itemWithBadge: NavItem = item;
              if (item.href === '/conversas' && unreadCount > 0) {
                itemWithBadge = { ...item, badge: unreadCount };
              } else if (item.href === '/sac' && sacCriticalCount > 0) {
                itemWithBadge = { ...item, badge: sacCriticalCount };
              } else if (item.href === '/social' && socialPendingCount > 0) {
                itemWithBadge = { ...item, badge: socialPendingCount };
              }
              return (
                <NavLink
                  key={item.href}
                  item={itemWithBadge}
                  active={isActive(pathname, item.href)}
                  collapsed={isCollapsed}
                />
              );
            })}
          </ul>

          <div className="mx-3 my-2 border-t border-border" />

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
            'border-t border-border p-2',
            isCollapsed ? 'flex justify-center' : '',
          )}
        >
          <ThemeToggle collapsed={isCollapsed} />
        </div>
      </aside>
    </>
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
          'group relative flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors',
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
