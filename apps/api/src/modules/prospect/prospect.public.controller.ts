import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ProspectService } from './prospect.service';
import type { OptOutPublicDto } from './prospect.types';

/** Janela em horas pra rate-limit por IP. */
const RATE_LIMIT_PER_HOUR = 5;

interface IpBucket {
  count: number;
  windowStart: number;
}

/**
 * Endpoint público (SEM auth) pra solicitar opt-out de coleta.
 * Obrigatório pela LGPD — quem foi prospectado pode pedir remoção.
 *
 * ⚠️ Resposta é sempre 200 (mesmo se documento não existe na base) pra não
 * vazar presença/ausência. Idempotente — múltiplos pedidos só registram
 * múltiplos entries no consent_ledger.
 *
 * Rate-limit: 5 chamadas/hora por IP (em memória, igual forms-public).
 */
@Controller('public/prospect')
export class ProspectPublicController {
  private readonly rateLimits = new Map<string, IpBucket>();

  constructor(private readonly svc: ProspectService) {}

  @Post('opt-out')
  @HttpCode(HttpStatus.OK)
  async optOut(@Body() body: OptOutPublicDto, @Req() req: Request) {
    const ip = this.extractIp(req);
    this.checkRateLimit(ip);
    return this.svc.optOutPublic(body, ip);
  }

  private extractIp(req: Request): string {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string') return xf.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
    if (Array.isArray(xf)) return xf[0] ?? req.ip ?? 'unknown';
    return req.ip ?? 'unknown';
  }

  private checkRateLimit(ip: string): void {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const bucket = this.rateLimits.get(ip);
    if (!bucket || now - bucket.windowStart > oneHour) {
      this.rateLimits.set(ip, { count: 1, windowStart: now });
      return;
    }
    bucket.count += 1;
    if (bucket.count > RATE_LIMIT_PER_HOUR) {
      throw new HttpException(
        `Rate limit excedido (${RATE_LIMIT_PER_HOUR}/h por IP). Tente novamente em uma hora.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
