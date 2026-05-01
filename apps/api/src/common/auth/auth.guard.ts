import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { OrgMemberRole } from '@eclick-active/shared';
import { SupabaseService } from '../supabase/supabase.service';
import type { AuthUser } from './auth.types';

/**
 * Valida o JWT do header `Authorization: Bearer <token>` e resolve a organização
 * ativa do usuário via `active.org_members`. Anexa `request.user` (AuthUser).
 *
 * Aplica em routes via `@UseGuards(AuthGuard)` ou globalmente em main.ts.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const auth = req.headers.authorization ?? '';
    const match = /^Bearer (.+)$/.exec(auth);
    if (!match) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = match[1] as string;

    const authUser = await this.supabase.getUserFromJwt(token);
    if (!authUser) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const { data: member, error } = await this.supabase.adminClient
      .from('org_members')
      .select('org_id, role, status')
      .eq('user_id', authUser.id)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to load org_member: ${error.message}`);
      throw new UnauthorizedException('Could not resolve organization');
    }
    if (!member) {
      throw new ForbiddenException('User has no active organization membership');
    }

    const user: AuthUser = {
      id: authUser.id,
      org_id: member.org_id as string,
      role: member.role as OrgMemberRole,
      email: authUser.email,
    };
    req.user = user;
    return true;
  }
}
