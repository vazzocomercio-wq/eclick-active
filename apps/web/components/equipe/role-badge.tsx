import type { OrgMemberRole } from '@eclick-active/shared';
import { Crown } from 'lucide-react';
import { cn } from '@/lib/utils';

const ROLE_STYLES: Record<OrgMemberRole, { bg: string; text: string; label: string }> = {
  owner: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', label: 'Owner' },
  admin: { bg: 'bg-purple-500/15', text: 'text-purple-400', label: 'Admin' },
  manager: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Manager' },
  agent: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Agente' },
  viewer: { bg: 'bg-slate-500/15', text: 'text-slate-400', label: 'Viewer' },
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
      {s.label}
    </span>
  );
}

export function roleLabel(r: OrgMemberRole): string {
  return ROLE_STYLES[r].label;
}

export function StatusBadge({
  status,
}: {
  status: 'active' | 'invited' | 'suspended';
}) {
  const styles: Record<typeof status, { bg: string; text: string; label: string }> = {
    active: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Ativo' },
    invited: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Convidado' },
    suspended: { bg: 'bg-slate-500/15', text: 'text-slate-400', label: 'Suspenso' },
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
      {s.label}
    </span>
  );
}
