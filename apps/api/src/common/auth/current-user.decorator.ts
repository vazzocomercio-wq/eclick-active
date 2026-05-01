import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth.types';

/**
 * Extrai o `AuthUser` do request. Falha se a rota não estiver atrás do AuthGuard.
 *
 * Uso:
 *   `@Get() list(@CurrentUser() user: AuthUser) { ... }`
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.user) {
      throw new InternalServerErrorException(
        'CurrentUser used on a route without AuthGuard',
      );
    }
    return req.user;
  },
);
