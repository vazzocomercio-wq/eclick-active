'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Briefcase,
  CalendarClock,
  CheckSquare,
  Clock,
  Loader2,
  MessageCircle,
  Plus,
  Trash2,
  X,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  teamApi,
  type MemberStats,
  type MemberView,
} from '@/lib/api/team';
import { ApiError } from '@/lib/api/client';
import { formatRelativeTime, getInitials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ROLE_VALUES, RoleBadge, StatusBadge, useRoleLabel } from './role-badge';

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
  const t = useTranslations('equipe.detail');
  const roleLabel = useRoleLabel();
  const [stats, setStats] = useState<MemberStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [role, setRole] = useState<OrgMemberRole>('agent');
  const [whatsapp, setWhatsapp] = useState<string>('');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [specialtyInput, setSpecialtyInput] = useState('');
  const [duration, setDuration] = useState<string>('');
  const [buffer, setBuffer] = useState<string>('0');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!open || !member) return;
    setRole(member.role);
    setWhatsapp(member.whatsapp_phone ?? '');
    setSpecialties(member.specialties ?? []);
    setSpecialtyInput('');
    setDuration(
      member.default_duration_minutes != null
        ? String(member.default_duration_minutes)
        : '',
    );
    setBuffer(String(member.default_buffer_minutes ?? 0));
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

  async function handleSave() {
    if (!member) return;
    const patch: Parameters<typeof teamApi.update>[1] = {};
    if (role !== member.role) patch.role = role;

    if (whatsapp.trim() !== (member.whatsapp_phone ?? '')) {
      patch.whatsapp_phone = whatsapp.trim();
    }

    // Specialties só envia se mudou (compara como JSON pra cobrir reorder)
    const oldSpec = (member.specialties ?? []).slice().sort();
    const newSpec = specialties.slice().sort();
    if (JSON.stringify(oldSpec) !== JSON.stringify(newSpec)) {
      patch.specialties = specialties;
    }

    const newDuration = duration.trim() ? Number(duration) : null;
    if (newDuration !== member.default_duration_minutes) {
      patch.default_duration_minutes = newDuration;
    }

    const newBuffer = Number(buffer) || 0;
    if (newBuffer !== (member.default_buffer_minutes ?? 0)) {
      patch.default_buffer_minutes = newBuffer;
    }

    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await teamApi.update(member.id, patch);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : t('saveError'),
      );
    } finally {
      setSaving(false);
    }
  }

  function addSpecialty() {
    const t = specialtyInput.trim();
    if (!t || specialties.includes(t)) {
      setSpecialtyInput('');
      return;
    }
    setSpecialties((prev) => [...prev, t]);
    setSpecialtyInput('');
  }

  function removeSpecialty(s: string) {
    setSpecialties((prev) => prev.filter((x) => x !== s));
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
            : t('removeError'),
      );
    } finally {
      setRemoving(false);
    }
  }

  const displayName = member.display_name ?? member.email ?? t('noName');
  const oldSpecSorted = (member.specialties ?? []).slice().sort();
  const newSpecSorted = specialties.slice().sort();
  const newDurationParsed = duration.trim() ? Number(duration) : null;
  const dirty =
    role !== member.role ||
    whatsapp.trim() !== (member.whatsapp_phone ?? '') ||
    JSON.stringify(oldSpecSorted) !== JSON.stringify(newSpecSorted) ||
    newDurationParsed !== member.default_duration_minutes ||
    Number(buffer) !== (member.default_buffer_minutes ?? 0);

  return (
    <Sheet open={open} onOpenChange={(o) => !saving && !removing && onOpenChange(o)}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md" side="right">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>
            {member.created_at
              ? t('memberSince', {
                  date: new Date(member.created_at).toLocaleDateString('pt-BR'),
                })
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
                    {t('you')}
                  </span>
                )}
              </div>
              <span className="truncate text-[11px] text-muted-foreground">
                {member.email ?? t('noEmail')}
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
              {t('currentActivity')}
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
                  label={t('stats.conversations')}
                />
                <StatCard icon={Briefcase} value={stats.open_deals} label={t('stats.deals')} />
                <StatCard
                  icon={CheckSquare}
                  value={stats.pending_tasks}
                  label={t('stats.tasks')}
                />
              </div>
            ) : null}

            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              {member.last_seen_at
                ? t('lastSeen', { when: formatRelativeTime(member.last_seen_at) })
                : t('neverSeen')}
            </div>
          </section>

          {/* Role editor */}
          {canEdit ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('orgRole')}
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
                    {r === 'admin' && !canPromoteToAdmin ? ` ${t('ownerOnly')}` : ''}
                  </option>
                ))}
              </select>
            </section>
          ) : (
            <p className="text-xs text-muted-foreground">
              {isOwner ? t('ownerCantEdit') : t('noPermissionToEdit')}
            </p>
          )}

          {/* WhatsApp — alerta de tarefa URGENTE (Operação de Cadastro) */}
          {canEdit && (
            <section className="mt-5 flex flex-col gap-2 border-t border-border pt-5">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-3.5 w-3.5 text-primary" />
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('whatsapp')}
                </h3>
              </div>
              <Input
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder={t('whatsappPlaceholder')}
                className="h-9"
              />
              <span className="text-[10px] text-muted-foreground">{t('whatsappHint')}</span>
            </section>
          )}

          {/* Agendamento — duração + especialidades pra IA Concierge usar */}
          {canEdit && (
            <section className="mt-5 flex flex-col gap-3 border-t border-border pt-5">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-3.5 w-3.5 text-primary" />
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('scheduling')}
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="duration" className="text-[11px]">
                    {t('defaultDuration')}
                  </Label>
                  <Input
                    id="duration"
                    type="number"
                    min={5}
                    max={480}
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    placeholder={t('durationPlaceholder')}
                    className="h-9"
                  />
                  <span className="text-[10px] text-muted-foreground">{t('durationHint')}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="buffer" className="text-[11px]">
                    {t('buffer')}
                  </Label>
                  <Input
                    id="buffer"
                    type="number"
                    min={0}
                    max={120}
                    value={buffer}
                    onChange={(e) => setBuffer(e.target.value)}
                    placeholder="0"
                    className="h-9"
                  />
                  <span className="text-[10px] text-muted-foreground">{t('bufferHint')}</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px]">{t('specialties')}</Label>
                <div className="flex gap-1.5">
                  <Input
                    value={specialtyInput}
                    onChange={(e) => setSpecialtyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addSpecialty();
                      }
                    }}
                    placeholder={t('specialtiesPlaceholder')}
                    className="h-9 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addSpecialty}
                    disabled={!specialtyInput.trim()}
                    className="h-9 px-3"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {specialties.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {specialties.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 text-[11px] font-medium text-cyan-300"
                      >
                        {s}
                        <button
                          type="button"
                          onClick={() => removeSpecialty(s)}
                          className="rounded-full p-0.5 hover:bg-cyan-500/20"
                          aria-label={t('removeAria', { item: s })}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-[10px] italic text-muted-foreground">
                    {t('noSpecialties')}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground">{t('specialtiesHint')}</span>
              </div>
            </section>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          {canRemove ? (
            confirmRemove ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-destructive">{t('removeConfirm')}</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleRemove}
                  disabled={removing}
                >
                  {removing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  {t('yes')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                  {t('no')}
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
                {t('remove')}
              </Button>
            )
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('close')}
            </Button>
            {canEdit && (
              <Button onClick={handleSave} disabled={!dirty || saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('save')}
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
