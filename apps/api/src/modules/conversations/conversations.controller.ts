import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  Conversation,
  ConversationDetail,
  InboxItem,
} from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  ConversationsService,
  type StartConversationResult,
} from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { StartConversationDto } from './dto/start-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { ListConversationsQueryDto } from './dto/list-conversations.query.dto';
import { InitiateTransferDto } from './dto/transfer.dto';
import type { PaginatedResult } from '../contacts/contacts.service';
import { TransferService, type TransferBriefing } from '../ai/transfer.service';

@UseGuards(AuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly service: ConversationsService,
    private readonly transfer: TransferService,
  ) {}

  // POST /conversations/:id/transfer — escalação inteligente com briefing
  @Post(':id/transfer')
  @HttpCode(HttpStatus.OK)
  initiateTransfer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InitiateTransferDto,
  ): Promise<{ status: 'pending_permission' | 'transferred'; briefing?: TransferBriefing }> {
    return this.transfer.initiateTransfer(user.org_id, id, {
      reason: dto.reason,
      ...(dto.target_user_id ? { target_user_id: dto.target_user_id } : {}),
      ...(dto.ask_permission !== undefined ? { ask_permission: dto.ask_permission } : {}),
    });
  }

  // GET /conversations?page=&limit=&status=&priority=&assigned_to=&channel_type=&mine=&contact_id=
  @Get()
  inbox(
    @CurrentUser() user: AuthUser,
    @Query() filters: ListConversationsQueryDto,
  ): Promise<PaginatedResult<InboxItem>> {
    return this.service.getInbox(user.org_id, filters, user.id);
  }

  // POST /conversations — cria conversa nova (drawer "Iniciar conversa")
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateConversationDto,
  ): Promise<Conversation> {
    return this.service.create(user.org_id, dto);
  }

  /**
   * Iniciar conversa outbound — vendedor escolhe contato + canal + msg.
   * Cria conversa (ou reaproveita ativa) e envia primeira mensagem.
   *
   * Resposta inclui `reused: boolean` pra UI distinguir nova vs existente
   * (mostra toast "Conversa existente — abrindo" quando reused).
   */
  @Post('start')
  @HttpCode(HttpStatus.OK)
  start(
    @CurrentUser() user: AuthUser,
    @Body() dto: StartConversationDto,
  ): Promise<StartConversationResult> {
    return this.service.startConversation(user.org_id, user.id, dto);
  }

  // GET /conversations/:id
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationDetail> {
    return this.service.findById(user.org_id, id);
  }

  // PATCH /conversations/:id
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConversationDto,
  ): Promise<Conversation> {
    return this.service.update(user.org_id, id, dto);
  }

  // POST /conversations/:id/read
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markAsRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Conversation> {
    return this.service.markAsRead(user.org_id, id);
  }

  // POST /conversations/:id/star — alterna favorito (Melhoria 9)
  @Post(':id/star')
  @HttpCode(HttpStatus.OK)
  toggleStar(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Conversation> {
    return this.service.toggleStar(user.org_id, id);
  }

  /**
   * DELETE /conversations/:id — exclui PERMANENTEMENTE a conversa
   * e todas as mensagens (FK CASCADE). Não é recuperável.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.delete(user.org_id, id);
  }
}
