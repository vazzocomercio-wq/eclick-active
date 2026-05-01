'use client';

import { useEffect, useState } from 'react';
import {
  Briefcase,
  CheckSquare,
  Clock,
  Loader2,
  MessageCircle,
  Trash2,
} from 'lucide-react';
import type { OrgMemberRole } from '@eclick-active/shared';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  teamApi,
  type MemberStats,
  type MemberView,
} from '@/lib/api/team';
import { ApiError } from '@/lib/api/client';
import { formatRelativeTime, getInitials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ROLE_VALUES, RoleBadge, StatusBadge, roleLabel } from './role-badge';

interface MemberDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MemberView | null;
  /** Role do usuário atual — controla o que dá pra editar */
  currentUserRole: OrgMemberRole | null;
  /** ID do user logado — não permite remover a si mesmo */
  currentUserId: string | null;
  onChanged: () => void;
}

export function MemberDetailSheet({
  open,
  onOpenChange,
  member,
  currentUserRole,
  currentUserId,
  onChanged,
}: MemberDetailSheetProps) {
  const [stats, setStats] = useState<MemberStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [role, setRole] = useState<OrgMemberRole>('agent');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!open || !member) return;
    setRole(member.role);
    setError(null);
    setConfirmRemove(false);
    setStats(null);

    // Stats em background
    setStatsLoading(true);
    const ctrl = new AbortController();
    teamApi
      .stats(member.id, ctrl.signal)
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false));
    return () => ctrl.abort();
  }, [open, member]);

  if (!member) return null;

  const isOwner = member.role === 'owner';
  const isSelf = member.user_id === currentUserId;
  const canEdit =
    !isOwner &&
    currentUserRole !== null &&
    ['owner', 'admin'].includes(currentUserRole);
  const canRemove = canEdit && !isSelf;
  const canPromoteToAdmin = currentUserRole === 'owner';

  async function handleSaveRole() {
    if (!member || role === member.role) return;
    setSaving(true);
    setError(null);
    try {
      await teamApi.update(member.id, { role });
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao salvar',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!member) return;
    setRemoving(true);
    setError(null);
    try {
      await teamApi.remove(member.id);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erro ao remover',
      );
    } finally {
      setRemoving(false);
    }
  }

  const displayName = member.display_name ?? member.email ?? 'Sem nome';
  const dirty = role !== member.role;

  return (
    <Sheet open={open} onOpenChange={(o) => !saving && !removing && onOpenChange(o)}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md" side="right">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>Detalhes do membro</SheetTitle>
          <SheetDescription>
            {member.created_at
              ? `Membro desde ${new Date(member.created_at).toLocaleDateString('pt-BR')}`
              : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {error && (
            <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* Header do membro */}
          <div className="flex items-center gap-3 pb-4">
            <Avatar className="h-12 w-12">
              {member.avatar_url && (
                <AvatarImage src={member.avatar_url} alt={displayName} />
              )}
              <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{displayName}</span>
                {isSelf && (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    Você
                  </span>
                )}
              </div>
              <span className="truncate text-[11px] text-muted-foreground">
                {member.email ?? '(sem email)'}
              </span>
              <div className="mt-1 flex items-center gap-1.5">
                <RoleBadge role={member.role} />
                <StatusBadge status={member.status} />
              </div>
            </div>
          </div>

          {/* Stats */}
          <section className="mb-4 flex flex-col gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Atividade atual
            </h3>
            {statsLoading ? (
              <div className="flex flex-col gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
                ))}
              </div>
            ) : stats ? (
              <div className="grid grid-cols-3 gap-2">
                <StatCard
                  icon={MessageCircle}
                  value={stats.active_conversations}
                  label="Conversas"
                />
                <StatCard icon={Briefcase} value={stats.open_deals} label="Deals" />
                <StatCard
                  icon={CheckSquare}
                  value={stats.pending_tasks}
                  label="Tarefas"
                />
              </div>
            ) : null}

            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              {member.last_seen_at
                ? `Último acesso ${formatRelativeTime(member.last_seen_at)}`
                : 'Nunca acessou'}
            </div>
          </section>

          {/* Role editor */}
          {canEdit ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Papel na organização
              </h3>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as OrgMemberRole)}
                className={cn(
                  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              >
                {ROLE_VALUES.filter((r) => r !== 'owner').map((r) => (
                  <option
                    key={r}
                    value={r}
                    disabled={r === 'admin' && !canPromoteToAdmin}
                  >
                    {roleLabel(r)}
                    {r === 'admin' && !canPromoteToAdmin ? ' (apenas owner)' : ''}
                  </option>
                ))}
              </select>
            </section>
          ) : (
            <p className="text-xs text-muted-foreground">
              {isOwner
                ? 'O owner não pode ser editado.'
                : 'Você não tem permissão pra editar esse membro.'}
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          {canRemove ? (
            confirmRemove ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-destructive">Remover este membro?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleRemove}
                  disabled={removing}
                >
                  {removing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Sim
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                  Não
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Remover
              </Button>
            )
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Fechar
            </Button>
            {canEdit && (
              <Button onClick={handleSaveRole} disabled={!dirty || saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StatCard({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof MessageCircle;
  value: number;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-border bg-card p-3">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
