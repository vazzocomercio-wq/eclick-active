import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  /** máximo de requisições permitidas na janela */
  limit: number;
  /** janela em milissegundos */
  windowMs: number;
}

/**
 * Rate-limit leve em memória por (usuário + rota). Sem dependência externa —
 * suficiente pra conter abuso de endpoints caros (ex.: chamadas de IA).
 * Usar junto do AuthGuard: `@UseGuards(AuthGuard, RateLimitGuard)`.
 */
export const RateLimit = (limit: number, windowMs: number) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowMs } as RateLimitOptions);
