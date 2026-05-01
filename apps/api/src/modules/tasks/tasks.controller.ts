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
import type { Task } from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import type { PaginatedResult } from '../contacts/contacts.service';
import { TasksService, type TaskRow } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks.query.dto';

@UseGuards(AuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  // GET /tasks/my/today — declarado ANTES de :id pra não colidir
  @Get('my/today')
  myToday(@CurrentUser() user: AuthUser): Promise<TaskRow[]> {
    return this.service.getMyToday(user.org_id, user.id);
  }

  // GET /tasks/overdue
  @Get('overdue')
  overdue(@CurrentUser() user: AuthUser): Promise<TaskRow[]> {
    return this.service.getOverdue(user.org_id);
  }

  // GET /tasks
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() filters: ListTasksQueryDto,
  ): Promise<PaginatedResult<TaskRow>> {
    return this.service.findAll(user.org_id, filters, user.id);
  }

  // POST /tasks
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTaskDto,
  ): Promise<Task> {
    return this.service.create(user.org_id, dto, user.id);
  }

  // GET /tasks/:id
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskRow> {
    return this.service.findById(user.org_id, id);
  }

  // PATCH /tasks/:id
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<Task> {
    return this.service.update(user.org_id, id, dto);
  }

  // POST /tasks/:id/complete
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Task> {
    return this.service.complete(user.org_id, id);
  }

  // DELETE /tasks/:id
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.delete(user.org_id, id);
  }
}
