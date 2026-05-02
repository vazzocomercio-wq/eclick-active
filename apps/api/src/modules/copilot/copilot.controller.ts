import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  CopilotService,
  type CopilotMessageRecord,
  type ProcessQueryResult,
} from './copilot.service';
import { SendMessageDto } from './dto/send-message.dto';

@UseGuards(AuthGuard)
@Controller('copilot')
export class CopilotController {
  constructor(private readonly service: CopilotService) {}

  // POST /copilot/message — envia mensagem, retorna resposta + tool_calls
  @Post('message')
  @HttpCode(HttpStatus.OK)
  message(
    @CurrentUser() user: AuthUser,
    @Body() dto: SendMessageDto,
  ): Promise<ProcessQueryResult> {
    return this.service.processQuery(user.org_id, user.id, dto.message, {
      ...(dto.context_type ? { type: dto.context_type } : {}),
      ...(dto.context_id ? { id: dto.context_id } : {}),
    });
  }

  // GET /copilot/history — últimas mensagens (cronológicas)
  @Get('history')
  history(@CurrentUser() user: AuthUser): Promise<CopilotMessageRecord[]> {
    return this.service.getHistory(user.org_id, user.id);
  }

  // DELETE /copilot/history — limpa histórico do usuário
  @Delete('history')
  @HttpCode(HttpStatus.NO_CONTENT)
  clearHistory(@CurrentUser() user: AuthUser): Promise<void> {
    return this.service.clearHistory(user.org_id, user.id);
  }
}
