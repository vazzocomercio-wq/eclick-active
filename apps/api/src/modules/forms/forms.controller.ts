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
import type { Form, FormSubmission } from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { FormsService } from './forms.service';
import { CreateFormDto, UpdateFormDto } from './dto/form.dto';
import { getFormTemplates } from './form-templates';

@UseGuards(AuthGuard)
@Controller('forms')
export class FormsController {
  constructor(private readonly service: FormsService) {}

  @Get('templates')
  templates() {
    // Public list of templates (no auth dependency on org)
    return getFormTemplates();
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<Form[]> {
    return this.service.list(user.org_id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFormDto,
  ): Promise<Form> {
    return this.service.create(user.org_id, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Form> {
    return this.service.findById(user.org_id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFormDto,
  ): Promise<Form> {
    return this.service.update(user.org_id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.delete(user.org_id, id);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Form> {
    return this.service.publish(user.org_id, id);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  pause(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Form> {
    return this.service.pause(user.org_id, id);
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  duplicate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Form> {
    return this.service.duplicate(user.org_id, id);
  }

  @Get(':id/submissions')
  submissions(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ): Promise<{ data: FormSubmission[]; total: number }> {
    return this.service.getSubmissions(user.org_id, id, {
      page: pageStr ? Number(pageStr) : undefined,
      limit: limitStr ? Number(limitStr) : undefined,
    });
  }

  @Get(':id/analytics')
  analytics(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getAnalytics(user.org_id, id);
  }
}
