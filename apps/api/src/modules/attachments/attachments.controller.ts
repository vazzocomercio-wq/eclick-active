import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { AttachmentsService } from './attachments.service';

/**
 * Endpoints relacionados a attachments — UI usa pra montar render de
 * mídia + summary IA na conversation panel.
 */
@Controller('attachments')
@UseGuards(AuthGuard)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /**
   * GET /attachments/conversation/:id — lista attachments da conversa
   * com signed URLs já gerados pro frontend renderizar imagens/audio/etc.
   */
  @Get('conversation/:id')
  async listForConversation(
    @Param('id') conversationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.attachments.listForConversation(user.org_id, conversationId);
  }
}
