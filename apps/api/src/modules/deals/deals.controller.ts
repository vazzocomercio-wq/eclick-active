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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Deal, DealActivity } from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  DealsService,
  PaginatedDeals,
} from './deals.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { MoveDealDto } from './dto/move-deal.dto';
import { ReorderDealsDto } from './dto/reorder-deals.dto';
import { ListDealsQueryDto } from './dto/list-deals.query.dto';
import { AddActivityDto } from './dto/add-activity.dto';

@UseGuards(AuthGuard)
@Controller('deals')
export class DealsController {
  constructor(private readonly service: DealsService) {}

  // PUT /deals/reorder — declarado ANTES de :id pra não colidir com /:id (PATCH/DELETE)
  // (PUT vs PATCH/DELETE são métodos diferentes; ordem de declaração mantida por clareza)
  @Put('reorder')
  @HttpCode(HttpStatus.OK)
  reorder(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReorderDealsDto,
  ): Promise<Deal[]> {
    return this.service.reorderInStage(user.org_id, dto.stage_id, dto.deal_ids);
  }

  // GET /deals?page=&limit=&pipeline_id=&...
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() filters: ListDealsQueryDto,
  ): Promise<PaginatedDeals> {
    return this.service.findAll(user.org_id, filters);
  }

  // POST /deals
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDealDto,
  ): Promise<Deal> {
    return this.service.create(user.org_id, dto);
  }

  // GET /deals/:id — detalhe com joins
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(user.org_id, id);
  }

  // PATCH /deals/:id
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDealDto,
  ): Promise<Deal> {
    return this.service.update(user.org_id, id, dto);
  }

  // DELETE /deals/:id
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.delete(user.org_id, id);
  }

  // POST /deals/:id/move
  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  move(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveDealDto,
  ): Promise<Deal> {
    return this.service.moveToStage(user.org_id, id, dto, user.id);
  }

  // GET /deals/:id/activities
  @Get(':id/activities')
  activities(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DealActivity[]> {
    return this.service.getDealActivities(user.org_id, id);
  }

  // POST /deals/:id/activities — registra uma atividade manual (note_added etc.)
  @Post(':id/activities')
  @HttpCode(HttpStatus.CREATED)
  addActivity(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddActivityDto,
  ): Promise<DealActivity> {
    return this.service.addActivity(user.org_id, id, user.id, dto);
  }
}
