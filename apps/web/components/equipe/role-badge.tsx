'use client';

import { useTranslations } from 'next-intl';
import type { OrgMemberRole } from '@eclick-active/shared';
import { Crown } from 'lucide-react';
import { cn } from '@/lib/utils';

const ROLE_STYLES: Record<OrgMemberRole, { bg: string; text: string }> = {
  owner: { bg: 'bg-cyan-500/15', text: 'text-cyan-400' },
  admin: { bg: 'bg-purple-500/15', text: 'text-purple-400' },
  manager: { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  agent: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  viewer: { bg: 'bg-slate-500/15', text: 'text-slate-400' },
};

export const ROLE_VALUES: OrgMemberRole[] = [
  'owner',
  'admin',
  'manager',
  'agent',
  'viewer',
];

export function RoleBadge({
  role,
  className,
}: {
  role: OrgMemberRole;
  className?: string;
}) {
  const t = useTranslations('equipe.role');
  const s = ROLE_STYLES[role];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
        s.bg,
        s.text,
        className,
      )}
    >
      {role === 'owner' && <Crown className="h-3 w-3" />}
      {t(role)}
    </span>
  );
}

/** Hook-only — chame de dentro de um client component. */
export function useRoleLabel(): (r: OrgMemberRole) => string {
  const t = useTranslations('equipe.role');
  return (r: OrgMemberRole) => t(r);
}

/** @deprecated Use `useRoleLabel()` em client components — esta versão lê
 * do dicionário PT como fallback estático. */
export function roleLabel(r: OrgMemberRole): string {
  const STATIC_PT: Record<OrgMemberRole, string> = {
    owner: 'Owner',
    admin: 'Admin',
    manager: 'Manager',
    agent: 'Agente',
    viewer: 'Viewer',
  };
  return STATIC_PT[r];
}

export function StatusBadge({
  status,
}: {
  status: 'active' | 'invited' | 'suspended';
}) {
  const t = useTranslations('equipe.status');
  const styles: Record<typeof status, { bg: string; text: string }> = {
    active: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
    invited: { bg: 'bg-yellow-500/15', text: 'text-yellow-400' },
    suspended: { bg: 'bg-slate-500/15', text: 'text-slate-400' },
  };
  const s = styles[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium',
        s.bg,
        s.text,
      )}
    >
      {t(status)}
    </span>
  );
}
