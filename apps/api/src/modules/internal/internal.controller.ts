import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import {
  EventsGateway,
  type EventName,
  type EventPayloadMap,
} from '../../gateways/events.gateway';

interface RealtimeBroadcastDto {
  org_id: string;
  event: EventName;
  payload: unknown;
}

/**
 * Endpoint interno consumido pelo worker (apps/workers) pra disparar
 * broadcasts socket.io via EventsGateway. Worker NÃO conecta direto no
 * socket.io — ele POSTa aqui com `X-Internal-Key`.
 *
 * Não é exposto na docs externa nem fica atrás do AuthGuard. A "auth"
 * é o secret compartilhado em `INTERNAL_API_KEY`. Se a key não bater,
 * 403. Se faltar a env do server, 503 (não dá pra validar nada).
 */
@Controller('internal')
export class InternalController {
  private readonly logger = new Logger(InternalController.name);

  constructor(private readonly events: EventsGateway) {}

  @Post('realtime')
  @HttpCode(HttpStatus.NO_CONTENT)
  broadcast(
    @Headers('x-internal-key') key: string | undefined,
    @Body() body: RealtimeBroadcastDto,
  ): void {
    const expected = process.env.INTERNAL_API_KEY;
    if (!expected) {
      this.logger.error('INTERNAL_API_KEY não configurado — recusando broadcast');
      throw new ForbiddenException('Internal channel disabled');
    }
    if (key !== expected) {
      this.logger.warn('Internal broadcast rejected: invalid key');
      throw new ForbiddenException('Invalid internal key');
    }
    if (!body?.org_id || !body?.event) {
      throw new BadRequestException('org_id e event são obrigatórios');
    }

    this.logger.log(
      `[internal] ← broadcast received event=${body.event} org=${body.org_id}`,
    );

    // Type-cast pra satisfazer EventPayloadMap; o caller (worker) é
    // responsável por mandar o payload correto pro evento.
    this.events.emitToOrg(
      body.org_id,
      body.event,
      body.payload as EventPayloadMap[typeof body.event],
    );
  }
}
