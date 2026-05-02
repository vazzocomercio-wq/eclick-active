import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AiTestConversation, AiTestMessage } from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { AiTestService } from './ai-test.service';
import { CreateTestSessionDto, SendTestMessageDto } from './dto/test.dto';

@UseGuards(AuthGuard)
@Controller('ai/test/sessions')
export class AiTestController {
  constructor(private readonly service: AiTestService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AiTestConversation[]> {
    return this.service.listSessions(user.org_id, user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTestSessionDto,
  ): Promise<AiTestConversation> {
    return this.service.createSession(user.org_id, user.id, dto.persona_id);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AiTestConversation> {
    return this.service.getSession(user.org_id, id);
  }

  @Post(':id/message')
  @HttpCode(HttpStatus.OK)
  sendMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendTestMessageDto,
  ): Promise<{ session: AiTestConversation; reply: AiTestMessage }> {
    return this.service.sendMessage(user.org_id, id, dto.content, dto.sources);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.deleteSession(user.org_id, id);
  }
}
