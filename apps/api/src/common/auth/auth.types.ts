import type { OrgMemberRole } from '@eclick-active/shared';

/** Forma anexada ao Request após o AuthGuard validar o JWT. */
export interface AuthUser {
  /** auth.users.id */
  id: string;
  /** organização ativa do usuário (active.org_members.org_id) */
  org_id: string;
  /** papel do usuário na organização */
  role: OrgMemberRole;
  /** email opcional, se vier no JWT */
  email?: string;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}
