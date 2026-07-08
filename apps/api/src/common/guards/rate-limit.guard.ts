import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const opts = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!opts) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as AuthUser | undefined;
    const scope = `${context.getClass().name}.${context.getHandler().name}`;
    const key = `${scope}:${user?.id ?? req.ip ?? 'anon'}`;

    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter(
      (t) => now - t < opts.windowMs,
    );

    if (recent.length >= opts.limit) {
      throw new HttpException(
        'Muitas requisições em pouco tempo. Aguarde alguns segundos e tente de novo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    this.hits.set(key, recent);

    // Limpeza preguiçosa pra não vazar memória em processo long-lived.
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) {
        if (v.every((t) => now - t >= opts.windowMs)) this.hits.delete(k);
      }
    }
    return true;
  }
}
