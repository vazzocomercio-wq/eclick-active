import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

const HEADER_NAME = 'x-automation-bridge-token';

/**
 * Guard que valida shared secret entre SaaS e Active.
 *
 * Uso:
 *   @UseGuards(AutomationBridgeGuard)
 *   @Controller('commerce/automation-bridge')
 *   class FooController { ... }
 *
 * Espera env `AUTOMATION_BRIDGE_SECRET` no Active. Mesmo valor configurado
 * no SaaS como `ACTIVE_AUTOMATION_BRIDGE_SECRET` (env do Railway). Se a
 * env não estiver setada, **TODOS os requests são rejeitados** — fail-safe.
 *
 * Comparação em tempo constante pra mitigar timing attacks.
 */
@Injectable()
export class AutomationBridgeGuard implements CanActivate {
  private readonly logger = new Logger(AutomationBridgeGuard.name);

  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env.AUTOMATION_BRIDGE_SECRET;
    if (!expected) {
      this.logger.error(
        'AUTOMATION_BRIDGE_SECRET não configurado — bloqueando bridge requests.',
      );
      throw new UnauthorizedException('Bridge secret not configured');
    }

    const req = ctx.switchToHttp().getRequest<Request>();
    const provided = req.headers[HEADER_NAME];
    const value = Array.isArray(provided) ? provided[0] : provided;

    if (!value || typeof value !== 'string') {
      throw new UnauthorizedException('Missing X-Automation-Bridge-Token');
    }

    if (!constantTimeEquals(value, expected)) {
      this.logger.warn(
        `Bridge token inválido vindo de ${req.ip ?? 'unknown'}`,
      );
      throw new UnauthorizedException('Invalid bridge token');
    }

    return true;
  }
}

/**
 * Comparação string em tempo aprox. constante. Não é tão forte quanto
 * `crypto.timingSafeEqual` (que precisa Buffer + same length), mas bom
 * o bastante pra um shared secret estático fora de hot path.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
