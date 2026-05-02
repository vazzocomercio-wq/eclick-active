import {
  Body,
  Controller,
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
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { ListConversationsQueryDto } from './dto/list-conversations.query.dto';
import type { PaginatedResult } from '../contacts/contacts.service';

@UseGuards(AuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

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
}
