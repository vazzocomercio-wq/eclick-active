import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';

/**
 * Valida o JWT do header `Authorization: Bearer <token>` e anexa
 * `request.user` (AuthUser). Lança 401 sem token / token inválido,
 * 403 quando o usuário não tem org_member ativa.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const auth = req.headers.authorization ?? '';
    const match = /^Bearer (.+)$/.exec(auth);
    if (!match) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = match[1] as string;

    const user = await this.auth.resolveUser(token);
    if (!user) {
      // resolveUser retorna null tanto pra token inválido quanto pra
      // usuário sem org. Pra HTTP separamos em 401 vs 403 — checamos a
      // segunda condição via `getUserFromJwt`.
      const supabaseUser = await this.tryGetUser(token);
      if (!supabaseUser) {
        throw new UnauthorizedException('Invalid or expired token');
      }
      throw new ForbiddenException('User has no active organization membership');
    }

    req.user = user;
    return true;
  }

  /**
   * Diferenciação entre token-inválido vs sem-org. Custo: 1 chamada extra
   * ao Supabase no caminho de erro — aceitável.
   */
  private async tryGetUser(jwt: string): Promise<{ id: string } | null> {
    return this.auth['supabase'].getUserFromJwt(jwt);
  }
}
