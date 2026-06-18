import { Injectable, Logger } from '@nestjs/common';
import type { OrgMemberRole } from '@eclick-active/shared';
import { SupabaseService } from '../supabase/supabase.service';
import type { AuthUser } from './auth.types';

/**
 * Resolve um JWT do Supabase em um `AuthUser` (id + org_id + role).
 *
 * Reutilizado pelo AuthGuard (HTTP) e pelo EventsGateway (WebSocket) — em
 * vez de duplicar a lógica de validar o token e buscar o `org_member`.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Retorna o `AuthUser` resolvido ou `null` se o token for inválido / o
   * usuário não tiver membership ativa em nenhuma organização.
   *
   * Auto-ativação de convite: apresentar um JWT válido só é possível depois
   * que o convidado clicou no magic link e definiu a senha (= aceitou o
   * convite). Por isso, se o usuário ainda só tem membership `invited`,
   * promovemos pra `active` no 1º acesso autenticado. Sem isso o convidado
   * ficava preso em `invited` pra sempre (a página /aceitar-convite só seta
   * a senha, nunca flipava o status) e tomava 403 eternamente.
   */
  async resolveUser(jwt: string): Promise<AuthUser | null> {
    const authUser = await this.supabase.getUserFromJwt(jwt);
    if (!authUser) return null;

    const { data: members, error } = await this.supabase.adminClient
      .from('org_members')
      .select('id, org_id, role, status')
      .eq('user_id', authUser.id)
      .in('status', ['active', 'invited']);

    if (error) {
      this.logger.error(`org_members lookup failed: ${error.message}`);
      return null;
    }
    if (!members || members.length === 0) return null;

    type MemberRow = { id: string; org_id: string; role: string; status: string };
    const rows = members as MemberRow[];

    // Prioriza uma membership já ativa; senão promove a primeira convidada.
    let member = rows.find((m) => m.status === 'active');
    if (!member) {
      const invited = rows[0];
      const { error: promoteErr } = await this.supabase.adminClient
        .from('org_members')
        .update({ status: 'active' })
        .eq('id', invited.id);
      if (promoteErr) {
        this.logger.error(`auto-ativação de convite falhou: ${promoteErr.message}`);
        return null;
      }
      this.logger.log(
        `[invite] membership ${invited.id} (user ${authUser.id}) ativada no 1º acesso`,
      );
      member = { ...invited, status: 'active' };
    }

    return {
      id: authUser.id,
      org_id: member.org_id,
      role: member.role as OrgMemberRole,
      email: authUser.email,
    };
  }
}
