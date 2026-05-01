'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, UserCog } from 'lucide-react';
import type { OrgMemberRole } from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { teamApi, type MemberView } from '@/lib/api/team';
import { ApiError } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';
import { formatRelativeTime, getInitials } from '@/lib/format';
import { InviteMemberDialog } from '@/components/equipe/invite-member-dialog';
import { MemberDetailSheet } from '@/components/equipe/member-detail-sheet';
import { RoleBadge, StatusBadge } from '@/components/equipe/role-badge';
import { cn } from '@/lib/utils';

export default function EquipePage() {
  const [members, setMembers] = useState<MemberView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selected, setSelected] = useState<MemberView | null>(null);

  // Identidade do usuário atual (vem da sessão Supabase) — usado pra gating
  // de UI (não pode editar a si mesmo, etc)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<OrgMemberRole | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const list = await teamApi.list();
      setMembers(list);
      // Sincroniza role do usuário atual (caso ele se promoveu/foi promovido)
      if (currentUserId) {
        const me = list.find((m) => m.user_id === currentUserId);
        if (me) setCurrentUserRole(me.role);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar equipe',
      );
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) setCurrentUserId(data.user.id);
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <UserCog className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-semibold">Equipe</h1>
            {!loading && (
              <span className="text-xs text-muted-foreground">
                · {members.length} {members.length === 1 ? 'membro' : 'membros'}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Gerencie membros, papéis e permissões da organização.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Convidar membro
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-6">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {loading && members.length === 0 ? (
            <SkeletonList />
          ) : members.length === 0 ? (
            <EmptyState onInvite={() => setInviteOpen(true)} />
          ) : (
            <ul className="flex flex-col gap-2">
              {members.map((m) => (
                <li key={m.id}>
                  <MemberRow
                    member={m}
                    isSelf={m.user_id === currentUserId}
                    onSelect={() => setSelected(m)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={reload}
      />

      <MemberDetailSheet
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
        member={selected}
        currentUserRole={currentUserRole}
        currentUserId={currentUserId}
        onChanged={reload}
      />
    </div>
  );
}

function MemberRow({
  member,
  isSelf,
  onSelect,
}: {
  member: MemberView;
  isSelf: boolean;
  onSelect: () => void;
}) {
  const displayName = member.display_name ?? member.email ?? 'Sem nome';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all',
        'hover:border-primary/30 hover:shadow-sm',
        member.status === 'suspended' && 'opacity-60',
      )}
    >
      <Avatar className="h-10 w-10 shrink-0">
        {member.avatar_url && <AvatarImage src={member.avatar_url} alt={displayName} />}
        <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{displayName}</span>
          {isSelf && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Você
            </span>
          )}
        </div>
        <span className="truncate text-[11px] text-muted-foreground">
          {member.email ?? '—'}
        </span>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          <RoleBadge role={member.role} />
          <StatusBadge status={member.status} />
        </div>
        <span className="text-[10px] text-muted-foreground">
          {member.last_seen_at
            ? `Visto ${formatRelativeTime(member.last_seen_at)}`
            : 'Nunca acessou'}
        </span>
      </div>
    </button>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

function EmptyState({ onInvite }: { onInvite: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <UserCog className="h-6 w-6" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Time vazio</p>
        <p className="text-xs text-muted-foreground">
          Convide colegas para colaborar na operação.
        </p>
      </div>
      <Button size="sm" onClick={onInvite}>
        <Plus className="mr-2 h-3.5 w-3.5" />
        Convidar primeiro membro
      </Button>
    </div>
  );
}
