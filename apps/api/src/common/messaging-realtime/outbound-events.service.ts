import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { EventsGateway } from '../../gateways/events.gateway';

/**
 * Helper centralizado pra emitir `message:new` + `conversation:updated`
 * via socket.io quando um SENDER AUTOMATIZADO (bot, worker, IA) persiste
 * msg outbound bypassando o `MessagesService.create` (path humano que já
 * emite events).
 *
 * Sem isso a UI só recebe a msg quando user perde+volta foco da aba
 * (silent refetch em use-chat). Sintoma: "msg da IA demora a aparecer
 * ou não aparece".
 *
 * Best-effort: erros aqui nunca derrubam o fluxo principal.
 *
 * Consumers:
 *   - AiConciergeService.sendOutbound
 *   - ReEngagementService.attemptReEngage
 *   - AppointmentsService.sendAppointmentReminder (TODO)
 *   - AdLeadsService.sendInitialGreeting (TODO)
 *   - AlertEngineService.dispatchOne (TODO)
 */
@Injectable()
export class OutboundEventsService {
  private readonly logger = new Logger(OutboundEventsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly events: EventsGateway,
  ) {}

  /**
   * Busca msg final no DB e dispara `message:new` + `conversation:updated`.
   * `messageCreatedAt` é necessário pro partition pruning em active.messages.
   */
  async notifyOutbound(args: {
    orgId: string;
    conversationId: string;
    messageId: string;
    messageCreatedAt: string;
  }): Promise<void> {
    try {
      const { data: full } = await this.supabase.adminClient
        .from('messages')
        .select('*')
        .eq('org_id', args.orgId)
        .eq('id', args.messageId)
        .eq('created_at', args.messageCreatedAt)
        .maybeSingle();
      if (full) {
        this.events.emitToOrg(args.orgId, 'message:new', {
          conversation_id: args.conversationId,
          message: full,
        });
      }
      const { data: conv } = await this.supabase.adminClient
        .from('conversations')
        .select('*')
        .eq('org_id', args.orgId)
        .eq('id', args.conversationId)
        .maybeSingle();
      if (conv) {
        this.events.emitToOrg(args.orgId, 'conversation:updated', {
          conversation: conv,
        });
      }
    } catch (err) {
      this.logger.warn(
        `notifyOutbound falhou (non-fatal) conv=${args.conversationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
