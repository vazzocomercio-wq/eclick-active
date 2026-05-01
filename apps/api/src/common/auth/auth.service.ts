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
   */
  async resolveUser(jwt: string): Promise<AuthUser | null> {
    const authUser = await this.supabase.getUserFromJwt(jwt);
    if (!authUser) return null;

    const { data: member, error } = await this.supabase.adminClient
      .from('org_members')
      .select('org_id, role, status')
      .eq('user_id', authUser.id)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      this.logger.error(`org_members lookup failed: ${error.message}`);
      return null;
    }
    if (!member) return null;

    return {
      id: authUser.id,
      org_id: member.org_id as string,
      role: member.role as OrgMemberRole,
      email: authUser.email,
    };
  }
}
