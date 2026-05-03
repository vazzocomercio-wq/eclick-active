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
import { AiService } from '../ai/ai.service';
import { AutomationsService } from '../automations/automations.service';

interface RealtimeBroadcastDto {
  org_id: string;
  event: EventName;
  payload: unknown;
}

interface InboundProcessedDto {
  org_id: string;
  conversation_id: string;
  contact_id: string;
  message_id: string;
  channel_id: string;
  channel_type: string;
  message_text: string;
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

  constructor(
    private readonly events: EventsGateway,
    private readonly ai: AiService,
    private readonly automations: AutomationsService,
  ) {}

  /**
   * Chamado pelo worker (Baileys) após persistir uma mensagem INBOUND.
   * Dispara o pipeline completo de processamento:
   *   1. AI processInbound: classifica intent/sentiment/temperatura,
   *      sugere resposta pro agente, dispara concierge (auto-saudação +
   *      roteamento de pipeline), detecta scheduling, etc.
   *   2. Automations checkTriggers: dispara automações com trigger
   *      `message_received` que estiverem ativas pra essa org.
   *
   * Esse endpoint preenche o gap que existia: webhooks (Z-API/Email/IG/TT)
   * já chamavam essas funções; o worker do Baileys não, então mensagens
   * do WhatsApp Gratuito não disparavam nada de IA/automação. Agora sim.
   */
  @Post('inbound-processed')
  @HttpCode(HttpStatus.NO_CONTENT)
  inboundProcessed(
    @Headers('x-internal-key') key: string | undefined,
    @Body() body: InboundProcessedDto,
  ): void {
    this.assertInternalKey(key);
    if (
      !body?.org_id ||
      !body?.conversation_id ||
      !body?.message_id ||
      !body?.channel_id
    ) {
      throw new BadRequestException(
        'org_id, conversation_id, message_id e channel_id são obrigatórios',
      );
    }

    this.logger.log(
      `[internal] ← inbound-processed conv=${body.conversation_id} msg=${body.message_id} channel=${body.channel_type}`,
    );

    // Fire-and-forget — o caller não precisa esperar (worker tem outras
    // mensagens pra processar).
    void this.ai.processInbound(body.org_id, body.conversation_id, body.message_id).catch(
      (err) => {
        this.logger.warn(
          `processInbound failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );

    void this.automations
      .checkTriggers({
        event: 'message_received',
        org_id: body.org_id,
        conversation_id: body.conversation_id,
        contact_id: body.contact_id,
        channel_id: body.channel_id,
        channel_type: body.channel_type,
        message_id: body.message_id,
        message_text: body.message_text ?? '',
        ai_intent: null,
      })
      .catch((err) => {
        this.logger.warn(
          `checkTriggers failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  private assertInternalKey(key: string | undefined): void {
    const expected = process.env.INTERNAL_API_KEY;
    if (!expected) {
      this.logger.error('INTERNAL_API_KEY não configurado');
      throw new ForbiddenException('Internal channel disabled');
    }
    if (key !== expected) {
      this.logger.warn('Internal request rejected: invalid key');
      throw new ForbiddenException('Invalid internal key');
    }
  }

  @Post('realtime')
  @HttpCode(HttpStatus.NO_CONTENT)
  broadcast(
    @Headers('x-internal-key') key: string | undefined,
    @Body() body: RealtimeBroadcastDto,
  ): void {
    this.assertInternalKey(key);
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
