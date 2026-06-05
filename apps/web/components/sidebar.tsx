'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Bot,
  Calendar,
  CalendarClock,
  CalendarRange,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  FileText,
  Gauge,
  Headphones,
  Inbox,
  Kanban,
  Layout,
  LayoutDashboard,
  Building2,
  Megaphone,
  MessageSquare,
  Newspaper,
  Radar,
  Settings,
  TrendingUp,
  UserCog,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';
import { useUnreadCount } from '@/hooks/use-unread-count';
import { useSacCriticalCount } from '@/hooks/use-sac';
import { useSocialPendingCount } from '@/hooks/use-social';

// ────────────────────────────────────────────────────────────────────────
// Estrutura
// ────────────────────────────────────────────────────────────────────────

interface NavItem {
  type:   'item';
  href:   string;
  icon:   LucideIcon;
  /** Chave de tradução dentro do namespace `nav` (ex.: 'items.conversas'). */
  labelKey: string;
  badge?: number;
  tag?:   string;
}

interface NavGroup {
  type:   'group';
  key:    string;       // chave estável pra localStorage
  icon:   LucideIcon;
  /** Chave de tradução dentro do namespace `nav` (ex.: 'sections.crm'). */
  labelKey: string;
  items:  NavItem[];
}

type NavEntry = NavItem | NavGroup;

// Dois itens avulsos no topo + 4 grupos por fluxo:
//   Atender → Vender (CRM) → Atrair (Marketing) → Medir (Análise)
const PRIMARY_NAV: NavEntry[] = [
  { type: 'item', href: '/central-de-acao', icon: LayoutDashboard, labelKey: 'items.centralDeAcao' },
  { type: 'item', href: '/copiloto',        icon: Bot,             labelKey: 'items.copiloto', tag: 'AI' },
  {
    type: 'group', key: 'atendimento', icon: Inbox, labelKey: 'sections.atendimento',
    items: [
      { type: 'item', href: '/conversas',  icon: MessageSquare, labelKey: 'items.conversas' },
      { type: 'item', href: '/sac',        icon: Headphones,    labelKey: 'items.sac',        tag: 'AI' },
      { type: 'item', href: '/tarefas',    icon: CheckSquare,   labelKey: 'items.tarefas' },
      { type: 'item', href: '/agenda',     icon: CalendarClock, labelKey: 'items.agenda',     tag: 'AI' },
      { type: 'item', href: '/calendario', icon: Calendar,      labelKey: 'items.calendario' },
    ],
  },
  {
    type: 'group', key: 'crm', icon: Users, labelKey: 'sections.crm',
    items: [
      { type: 'item', href: '/prospect',    icon: Radar,    labelKey: 'items.prospeccao', tag: 'AI' },
      { type: 'item', href: '/funis',       icon: Kanban,   labelKey: 'items.funis' },
      { type: 'item', href: '/contatos',    icon: Users,    labelKey: 'items.contatos' },
      { type: 'item', href: '/formularios', icon: FileText, labelKey: 'items.formularios' },
    ],
  },
  {
    type: 'group', key: 'marketing', icon: Megaphone, labelKey: 'sections.marketing',
    items: [
      { type: 'item', href: '/calendario-conteudo', icon: CalendarRange, labelKey: 'items.calendarioConteudo', tag: 'AI' },
      { type: 'item', href: '/social',              icon: Megaphone,     labelKey: 'items.social',             tag: 'AI' },
      { type: 'item', href: '/ads-central',         icon: Gauge,         labelKey: 'items.adsCentral',         tag: 'AI' },
      { type: 'item', href: '/blog-ia',             icon: Newspaper,     labelKey: 'items.blogIa',             tag: 'AI' },
      { type: 'item', href: '/paginas',             icon: Layout,        labelKey: 'items.paginas',            tag: 'AI' },
      { type: 'item', href: '/automacoes',          icon: Zap,           labelKey: 'items.automacoes' },
    ],
  },
  {
    type: 'group', key: 'analise', icon: TrendingUp, labelKey: 'sections.analise',
    items: [
      { type: 'item', href: '/relatorios',   icon: BarChart3, labelKey: 'items.relatorios' },
      { type: 'item', href: '/conhecimento', icon: BookOpen,  labelKey: 'items.conhecimento' },
    ],
  },
];

const FOOTER_NAV: NavEntry[] = [
  {
    type: 'group', key: 'conta', icon: Settings, labelKey: 'sections.conta',
    items: [
      { type: 'item', href: '/equipe',        icon: UserCog,   labelKey: 'items.equipe' },
      { type: 'item', href: '/agencia',       icon: Building2, labelKey: 'items.agencia' },
      { type: 'item', href: '/configuracoes', icon: Settings,  labelKey: 'items.configuracoes' },
    ],
  },
];

const COLLAPSED_KEY = 'sidebar:collapsed';
const GROUP_KEY = (key: string) => `sidebar:group:${key}`;

interface SidebarProps {
  /** Quando true, em mobile a sidebar fica visível (translate-x-0). */
  mobileOpen?: boolean;
  /** Callback pra fechar em mobile (chamado ao clicar item, ESC, ou backdrop). */
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps = {}) {
  const t = useTranslations('nav');
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

  // Mapa de badges injetados dinamicamente (rota -> count)
  const dynamicBadges = useMemo<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    if (unreadCount > 0)        m['/conversas'] = unreadCount;
    if (sacCriticalCount > 0)   m['/sac']       = sacCriticalCount;
    if (socialPendingCount > 0) m['/social']    = socialPendingCount;
    return m;
  }, [unreadCount, sacCriticalCount, socialPendingCount]);

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
          'lg:static lg:translate-x-0 lg:transition-[width]',
          isCollapsed ? 'lg:w-16' : 'lg:w-64',
          'w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
        aria-label={t('aria.mainNav')}
      >
        {/* Logo + collapse/close toggle */}
        <div
          className={cn(
            'flex items-center border-b border-border',
            isCollapsed ? 'h-16 justify-center px-2' : 'h-20 justify-between px-4',
          )}
        >
          {isCollapsed ? (
            <button
              type="button"
              onClick={toggleCollapse}
              aria-label={t('aria.expandSidebar')}
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

          {!isCollapsed && (
            <button
              type="button"
              onClick={toggleCollapse}
              aria-label={t('aria.collapseSidebar')}
              className="hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground lg:flex"
            >
              <ChevronLeft
                className={cn('h-4 w-4 transition-transform', isCollapsed && 'rotate-180')}
              />
            </button>
          )}

          {mobileOpen && (
            <button
              type="button"
              onClick={onMobileClose}
              aria-label={t('aria.closeMenu')}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Primary nav */}
        <nav className="flex-1 overflow-y-auto py-2 scrollbar-auto-hide">
          <ul className="flex flex-col gap-0.5 px-2">
            {PRIMARY_NAV.map((entry) =>
              renderEntry(entry, { pathname, isCollapsed, dynamicBadges, t }),
            )}
          </ul>

          <div className="mx-3 my-2 border-t border-border" />

          <ul className="flex flex-col gap-0.5 px-2">
            {FOOTER_NAV.map((entry) =>
              renderEntry(entry, { pathname, isCollapsed, dynamicBadges, t }),
            )}
          </ul>
        </nav>

        {/* Idioma + tema */}
        <div
          className={cn(
            'border-t border-border p-2',
            isCollapsed ? 'flex flex-col items-center gap-1' : 'space-y-1',
          )}
        >
          <LanguageSwitcher collapsed={isCollapsed} />
          <ThemeToggle collapsed={isCollapsed} />
        </div>
      </aside>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(href + '/');
}

function groupHasActiveChild(group: NavGroup, pathname: string | null): boolean {
  return group.items.some((it) => isActive(pathname, it.href));
}

/** Tradutor do namespace `nav` (retorno de useTranslations('nav')). */
type NavTranslator = (key: string, values?: Record<string, string | number>) => string;

interface RenderCtx {
  pathname:       string | null;
  isCollapsed:    boolean;
  dynamicBadges:  Record<string, number>;
  t:              NavTranslator;
}

function applyDynamic(item: NavItem, dyn: Record<string, number>): NavItem {
  const count = dyn[item.href];
  if (typeof count === 'number' && count > 0) {
    return { ...item, badge: count };
  }
  return item;
}

function renderEntry(entry: NavEntry, ctx: RenderCtx) {
  if (entry.type === 'item') {
    const item = applyDynamic(entry, ctx.dynamicBadges);
    return (
      <NavLink
        key={item.href}
        item={item}
        active={isActive(ctx.pathname, item.href)}
        collapsed={ctx.isCollapsed}
        t={ctx.t}
      />
    );
  }
  return <NavGroupRenderer key={entry.key} group={entry} ctx={ctx} />;
}

// ────────────────────────────────────────────────────────────────────────
// Componentes
// ────────────────────────────────────────────────────────────────────────

interface NavLinkProps {
  item:      NavItem;
  active:    boolean;
  collapsed: boolean;
  t:         NavTranslator;
  /** Quando true, recua o item indicando que está dentro de um grupo. */
  nested?:   boolean;
}

function NavLink({ item, active, collapsed, t, nested = false }: NavLinkProps) {
  const Icon = item.icon;
  const label = t(item.labelKey);
  return (
    <li>
      <Link
        href={item.href}
        title={collapsed ? label : undefined}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group relative flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors',
          'border-l-2 border-transparent',
          active
            ? 'border-primary bg-card text-foreground'
            : 'text-muted-foreground hover:bg-card/50 hover:text-foreground',
          collapsed && 'justify-center px-2',
          nested && !collapsed && 'pl-8',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{label}</span>
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

interface NavGroupRendererProps {
  group: NavGroup;
  ctx:   RenderCtx;
}

function NavGroupRenderer({ group, ctx }: NavGroupRendererProps) {
  const Icon = group.icon;
  const hasActiveChild = groupHasActiveChild(group, ctx.pathname);

  // Estado expandido — abre se tem filho ativo ou se localStorage salvou aberto.
  // Default: aberto na primeira visita.
  const [open, setOpen] = useState<boolean>(true);
  const [readyOpen, setReadyOpen] = useState<boolean>(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(GROUP_KEY(group.key));
      if (saved === '0')      setOpen(false);
      else if (saved === '1') setOpen(true);
      else                    setOpen(true); // default
    } catch {
      /* ignore */
    }
    setReadyOpen(true);
  }, [group.key]);

  // Se rota ativa entrou nesse grupo, força abrir
  useEffect(() => {
    if (hasActiveChild) setOpen(true);
  }, [hasActiveChild]);

  function toggleOpen() {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(GROUP_KEY(group.key), next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Em sidebar icon-only, achata: mostra todos os filhos diretamente sem header
  // Mantém UX simples (tooltip com label do filho).
  if (ctx.isCollapsed) {
    return (
      <>
        {group.items.map((item) => {
          const withDyn = applyDynamic(item, ctx.dynamicBadges);
          return (
            <NavLink
              key={item.href}
              item={withDyn}
              active={isActive(ctx.pathname, item.href)}
              collapsed
              t={ctx.t}
            />
          );
        })}
      </>
    );
  }

  // Soma badges + acumula tags pra mostrar no header colapsado
  const childItems = group.items.map((it) => applyDynamic(it, ctx.dynamicBadges));
  const totalBadge = childItems.reduce((acc, it) => acc + (it.badge ?? 0), 0);
  const hasAiChild = childItems.some((it) => it.tag === 'AI');

  // Enquanto não leu localStorage, segue default (open=true) sem flicker
  const isOpen = readyOpen ? open : true;

  return (
    <li>
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        className={cn(
          'group relative flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors',
          'border-l-2 border-transparent',
          hasActiveChild
            ? 'text-foreground'
            : 'text-muted-foreground hover:bg-card/50 hover:text-foreground',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate text-left font-medium">{ctx.t(group.labelKey)}</span>

        {/* Badges/tags acumulados quando fechado */}
        {!isOpen && totalBadge > 0 && (
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/15 px-1.5 text-xs font-medium text-primary">
            {totalBadge}
          </span>
        )}
        {!isOpen && hasAiChild && totalBadge === 0 && (
          <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            AI
          </span>
        )}

        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            isOpen ? 'rotate-0' : '-rotate-90',
          )}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <ul className="flex flex-col gap-0.5 mt-0.5">
          {childItems.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(ctx.pathname, item.href)}
              collapsed={false}
              t={ctx.t}
              nested
            />
          ))}
        </ul>
      )}
    </li>
  );
}
