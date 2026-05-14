import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { OrgMemberRole } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { InviteMemberDto, UpdateMemberDto } from './dto/invite-member.dto';

export interface MemberView {
  id: string;
  user_id: string;
  org_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: OrgMemberRole;
  status: 'active' | 'invited' | 'suspended';
  workspace_ids: string[];
  last_seen_at: string | null;
  /** Especialidades/serviços que o profissional atende (texto livre por org). */
  specialties: string[];
  /** Duração padrão por atendimento em minutos (NULL = usa appointment_type). */
  default_duration_minutes: number | null;
  /** Buffer entre atendimentos em minutos. Default 0. */
  default_buffer_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface MemberStats {
  active_conversations: number;
  open_deals: number;
  pending_tasks: number;
  last_seen_at: string | null;
}

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ────────────────────────────────────────────
  // LIST
  // ────────────────────────────────────────────

  async getMembers(orgId: string): Promise<MemberView[]> {
    const { data: members, error } = await this.supabase.adminClient
      .from('org_members')
      .select(
        'id, user_id, org_id, role, status, workspace_ids, display_name, avatar_url, last_seen_at, specialties, default_duration_minutes, default_buffer_minutes, created_at, updated_at',
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error(`getMembers failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    const rows = (members ?? []) as Array<Omit<MemberView, 'email'>>;
    if (rows.length === 0) return [];

    // Busca emails do auth.users em batch
    const emails = await this.fetchEmails(rows.map((m) => m.user_id));

    return rows.map((m) => ({
      ...m,
      email: emails.get(m.user_id) ?? null,
    }));
  }

  // ────────────────────────────────────────────
  // INVITE
  // ────────────────────────────────────────────

  async inviteMember(
    orgId: string,
    inviterRole: OrgMemberRole,
    dto: InviteMemberDto,
  ): Promise<MemberView> {
    if (!['owner', 'admin'].includes(inviterRole)) {
      throw new ForbiddenException('Apenas owner/admin podem convidar membros.');
    }

    // 1. Checa limite de plano
    await this.assertWithinPlanLimit(orgId);

    const email = dto.email.trim().toLowerCase();

    // 2. Tenta encontrar user existente no auth.users (via admin)
    let userId = await this.findAuthUserIdByEmail(email);

    // 3. Se não existir, cria via admin.inviteUserByEmail
    if (!userId) {
      userId = await this.inviteAuthUser(orgId, email, dto.display_name);
    }

    // 4. Verifica se já é membro dessa org
    const { data: existing } = await this.supabase.adminClient
      .from('org_members')
      .select('id')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      throw new ConflictException('Esse email já é membro da organização.');
    }

    // 5. Insere em org_members com status='invited'
    const { data, error } = await this.supabase.adminClient
      .from('org_members')
      .insert({
        org_id: orgId,
        user_id: userId,
        role: dto.role,
        status: 'invited',
        display_name: dto.display_name ?? null,
      })
      .select(
        'id, user_id, org_id, role, status, workspace_ids, display_name, avatar_url, last_seen_at, specialties, default_duration_minutes, default_buffer_minutes, created_at, updated_at',
      )
      .single();

    if (error || !data) {
      this.logger.error(`inviteMember failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to invite member',
      );
    }

    return { ...(data as Omit<MemberView, 'email'>), email };
  }

  // ────────────────────────────────────────────
  // UPDATE
  // ────────────────────────────────────────────

  async updateMember(
    orgId: string,
    actorRole: OrgMemberRole,
    memberId: string,
    dto: UpdateMemberDto,
  ): Promise<MemberView> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException('Apenas owner/admin podem editar membros.');
    }

    const member = await this.findMemberById(orgId, memberId);

    // Owner não pode ser rebaixado
    if (member.role === 'owner' && dto.role && dto.role !== 'owner') {
      throw new ForbiddenException('Owner não pode ser rebaixado.');
    }

    // Apenas owner pode promover alguém a owner ou admin
    if (
      dto.role &&
      ['owner', 'admin'].includes(dto.role) &&
      actorRole !== 'owner'
    ) {
      throw new ForbiddenException(
        'Apenas owner pode promover membros a owner ou admin.',
      );
    }

    const patch: Record<string, unknown> = {};
    if (dto.role) patch.role = dto.role;
    if (dto.workspace_ids) patch.workspace_ids = dto.workspace_ids;
    if (dto.display_name !== undefined) patch.display_name = dto.display_name;
    if (dto.specialties !== undefined) patch.specialties = dto.specialties;
    if (dto.default_duration_minutes !== undefined)
      patch.default_duration_minutes = dto.default_duration_minutes;
    if (dto.default_buffer_minutes !== undefined)
      patch.default_buffer_minutes = dto.default_buffer_minutes;

    const { data, error } = await this.supabase.adminClient
      .from('org_members')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', memberId)
      .select(
        'id, user_id, org_id, role, status, workspace_ids, display_name, avatar_url, last_seen_at, specialties, default_duration_minutes, default_buffer_minutes, created_at, updated_at',
      )
      .single();

    if (error || !data) {
      this.logger.error(`updateMember failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to update member',
      );
    }

    const emails = await this.fetchEmails([(data as { user_id: string }).user_id]);
    return {
      ...(data as Omit<MemberView, 'email'>),
      email: emails.get((data as { user_id: string }).user_id) ?? null,
    };
  }

  // ────────────────────────────────────────────
  // REMOVE — soft (status='suspended')
  // ────────────────────────────────────────────

  async removeMember(
    orgId: string,
    actorRole: OrgMemberRole,
    actorUserId: string,
    memberId: string,
  ): Promise<void> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException('Apenas owner/admin podem remover membros.');
    }

    const member = await this.findMemberById(orgId, memberId);

    if (member.role === 'owner') {
      throw new ForbiddenException('Owner não pode ser removido.');
    }

    if (member.user_id === actorUserId) {
      throw new BadRequestException('Você não pode remover a si mesmo.');
    }

    const { error } = await this.supabase.adminClient
      .from('org_members')
      .update({ status: 'suspended' })
      .eq('org_id', orgId)
      .eq('id', memberId);

    if (error) {
      this.logger.error(`removeMember failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  // ────────────────────────────────────────────
  // STATS
  // ────────────────────────────────────────────

  async getMemberStats(orgId: string, memberId: string): Promise<MemberStats> {
    const member = await this.findMemberById(orgId, memberId);

    const [convsResp, dealsResp, tasksResp] = await Promise.all([
      this.supabase.adminClient
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('assigned_to', member.user_id)
        .in('status', ['open', 'pending']),
      this.supabase.adminClient
        .from('deals')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('assigned_to', member.user_id)
        .is('won_at', null)
        .is('lost_at', null),
      this.supabase.adminClient
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('assigned_to', member.user_id)
        .in('status', ['pending', 'in_progress']),
    ]);

    return {
      active_conversations: convsResp.count ?? 0,
      open_deals: dealsResp.count ?? 0,
      pending_tasks: tasksResp.count ?? 0,
      last_seen_at: member.last_seen_at,
    };
  }

  // ────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────

  private async findMemberById(
    orgId: string,
    memberId: string,
  ): Promise<{
    id: string;
    user_id: string;
    role: OrgMemberRole;
    status: 'active' | 'invited' | 'suspended';
    last_seen_at: string | null;
  }> {
    const { data, error } = await this.supabase.adminClient
      .from('org_members')
      .select('id, user_id, role, status, last_seen_at')
      .eq('org_id', orgId)
      .eq('id', memberId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Member ${memberId} not found`);
    return data as {
      id: string;
      user_id: string;
      role: OrgMemberRole;
      status: 'active' | 'invited' | 'suspended';
      last_seen_at: string | null;
    };
  }

  private async assertWithinPlanLimit(orgId: string): Promise<void> {
    const { data: org, error: orgErr } = await this.supabase.adminClient
      .from('organizations')
      .select('max_users')
      .eq('id', orgId)
      .maybeSingle();

    if (orgErr) throw new InternalServerErrorException(orgErr.message);
    if (!org) throw new NotFoundException(`Org ${orgId} not found`);

    const maxUsers = (org as { max_users: number }).max_users;

    const { count, error } = await this.supabase.adminClient
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .neq('status', 'suspended');

    if (error) throw new InternalServerErrorException(error.message);
    if ((count ?? 0) >= maxUsers) {
      throw new ConflictException(
        `Limite de ${maxUsers} usuários do plano atingido. Faça upgrade pra adicionar mais.`,
      );
    }
  }

  private async findAuthUserIdByEmail(email: string): Promise<string | null> {
    // O SDK do supabase-js não expõe um lookup direto por email; usamos
    // listUsers com filtro client-side. Para orgs grandes, considerar
    // uma RPC dedicada. Aceitável aqui (poucas centenas de users).
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const auth = (this.supabase.adminClient as any).auth?.admin;
      if (!auth?.listUsers) return null;
      const { data, error } = await auth.listUsers({ perPage: 1000 });
      if (error || !data?.users) return null;
      const found = (data.users as Array<{ id: string; email?: string }>).find(
        (u) => u.email?.toLowerCase() === email,
      );
      return found?.id ?? null;
    } catch (err) {
      this.logger.warn(
        `findAuthUserIdByEmail fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async inviteAuthUser(
    orgId: string,
    email: string,
    displayName?: string,
  ): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = (this.supabase.adminClient as any).auth?.admin;
    if (!auth?.inviteUserByEmail) {
      throw new InternalServerErrorException(
        'Supabase admin auth não disponível para envio de convite.',
      );
    }

    // Lookup nome da org pra incluir no email template (placeholder
    // {{ .Data.org_name }} no template do Supabase Dashboard)
    const orgName = await this.fetchOrgName(orgId);

    // Redirect explícito > confiar só no Site URL global do Supabase.
    // Quando o user clica "Aceitar convite" no email, Supabase manda pra
    // aceitar-convite com tokens no hash; a página completa a sessão e
    // pede pra setar senha.
    const webBaseUrl =
      process.env.WEB_BASE_URL?.replace(/\/+$/, '') ?? 'https://active.eclick.app.br';
    const redirectTo = `${webBaseUrl}/aceitar-convite`;

    const metadata: Record<string, unknown> = {};
    if (displayName) metadata.display_name = displayName;
    if (orgName) metadata.org_name = orgName;

    const { data, error } = await auth.inviteUserByEmail(email, {
      data: metadata,
      redirectTo,
    });

    if (error || !data?.user) {
      // Fallback: tenta criar o user diretamente (sem email)
      const created = await auth.createUser({
        email,
        email_confirm: false,
        user_metadata: metadata,
      });
      if (created.error || !created.data?.user) {
        throw new InternalServerErrorException(
          `Failed to create auth user: ${error?.message ?? created.error?.message}`,
        );
      }
      return (created.data.user as { id: string }).id;
    }

    return (data.user as { id: string }).id;
  }

  private async fetchOrgName(orgId: string): Promise<string | null> {
    try {
      const { data } = await this.supabase.adminClient
        .from('organizations')
        .select('name')
        .eq('id', orgId)
        .maybeSingle();
      return (data as { name?: string } | null)?.name ?? null;
    } catch {
      return null;
    }
  }

  private async fetchEmails(userIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (userIds.length === 0) return map;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const auth = (this.supabase.adminClient as any).auth?.admin;
      if (!auth?.listUsers) return map;
      const { data } = await auth.listUsers({ perPage: 1000 });
      const byId = new Map(
        ((data?.users ?? []) as Array<{ id: string; email?: string }>).map(
          (u) => [u.id, u.email ?? ''],
        ),
      );
      for (const id of userIds) {
        const email = byId.get(id);
        if (email) map.set(id, email);
      }
    } catch {
      // sem auth admin disponível — devolve map vazio
    }
    return map;
  }
}
