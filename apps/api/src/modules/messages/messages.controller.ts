import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Message } from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { CursorPaginatedResult, MessagesService } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages.query.dto';

/**
 * Sub-recurso de Conversations. Path completo:
 *   GET  /conversations/:id/messages
 *   POST /conversations/:id/messages
 */
@UseGuards(AuthGuard)
@Controller('conversations/:id/messages')
export class MessagesController {
  constructor(private readonly service: MessagesService) {}

  // GET /conversations/:id/messages?cursor=&limit=
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<CursorPaginatedResult<Message>> {
    return this.service.findByConversation(
      user.org_id,
      conversationId,
      query.cursor,
      query.limit,
    );
  }

  // POST /conversations/:id/messages
  @Post()
  @HttpCode(HttpStatus.CREATED)
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendMessageDto,
  ): Promise<Message> {
    return this.service.create(user.org_id, conversationId, user.id, dto);
  }
}
