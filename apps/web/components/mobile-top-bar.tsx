'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useUnreadCount } from '@/hooks/use-unread-count';

interface MobileTopBarProps {
  onMenuClick: () => void;
}

/**
 * Top bar que aparece SÓ em mobile (lg:hidden). Tem hamburger pra abrir
 * o sidebar drawer, logo centralizado e badge de mensagens não-lidas.
 *
 * Em desktop (lg+) fica oculta — sidebar lateral é a navegação principal.
 */
export function MobileTopBar({ onMenuClick }: MobileTopBarProps) {
  const t = useTranslations('nav');
  const unreadCount = useUnreadCount();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-3 lg:hidden">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label={t('aria.openMenu')}
        className="relative flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-card"
      >
        <Menu className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <Link
        href="/central-de-acao"
        className="flex items-center"
        aria-label="e-Click Active"
      >
        <Image
          src="/logo-icon.svg"
          alt="e-Click Active"
          width={140}
          height={56}
          priority
          className="h-9 w-auto"
        />
      </Link>

      {/* Spacer pra balancear o layout (mesmo width do botão menu) */}
      <div className="h-10 w-10" />
    </header>
  );
}
