import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { BoardResponse, DealsService } from './deals.service';

/**
 * Controller separado pra rota `/pipelines/:pipelineId/board` — fica no
 * mesmo módulo do DealsController porque a query principal vem do
 * DealsService (uses v_deal_board view).
 */
@UseGuards(AuthGuard)
@Controller('pipelines')
export class BoardController {
  constructor(private readonly service: DealsService) {}

  @Get(':pipelineId/board')
  board(
    @CurrentUser() user: AuthUser,
    @Param('pipelineId', ParseUUIDPipe) pipelineId: string,
  ): Promise<BoardResponse> {
    return this.service.getBoard(user.org_id, pipelineId);
  }
}
