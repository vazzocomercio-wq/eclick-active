import { SetMetadata } from '@nestjs/common';
import type { OrgMemberRole } from '@eclick-active/shared';

export const ROLES_KEY = 'required_roles';

/**
 * Restringe um handler a papéis específicos da org. Usar SEMPRE junto do
 * AuthGuard e depois dele: `@UseGuards(AuthGuard, RolesGuard)`.
 * Sem o decorator, o RolesGuard deixa passar (rota aberta a qualquer membro).
 */
export const Roles = (...roles: OrgMemberRole[]) => SetMetadata(ROLES_KEY, roles);
