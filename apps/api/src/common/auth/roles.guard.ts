import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { OrgMemberRole } from '@eclick-active/shared';
import { ROLES_KEY } from './roles.decorator';
import type { AuthUser } from './auth.types';

/**
 * Autorização por papel. Roda depois do AuthGuard (que já populou req.user).
 * Handlers sem @Roles(...) são liberados a qualquer membro autenticado.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<OrgMemberRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as AuthUser | undefined;
    if (!user) throw new ForbiddenException('Não autenticado');
    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        'Você não tem permissão para esta ação. Fale com um administrador da conta.',
      );
    }
    return true;
  }
}
