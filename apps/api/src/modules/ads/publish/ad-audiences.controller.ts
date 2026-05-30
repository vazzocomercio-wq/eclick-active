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
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import {
  AdAudiencesService,
  type AdAudience,
  type CreateFromCrmDto,
  type CreateLookalikeDto,
} from './ad-audiences.service';

/**
 * Públicos do Meta a partir do CRM (Custom Audience + Lookalike).
 * Org-scoped via AuthGuard. Criar um público sobe contatos hasheados pra
 * conta de anúncios da própria org — ação iniciada pelo usuário.
 */
@UseGuards(AuthGuard)
@Controller('ad-audiences')
export class AdAudiencesController {
  constructor(private readonly service: AdAudiencesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AdAudience[]> {
    return this.service.list(user.org_id);
  }

  /** Cria um Custom Audience a partir dos contatos do CRM. */
  @Post('from-crm')
  fromCrm(@CurrentUser() user: AuthUser, @Body() dto: CreateFromCrmDto): Promise<AdAudience> {
    return this.service.createFromCrm(user.org_id, user.id, dto);
  }

  /** Cria um Lookalike a partir de um público existente. */
  @Post('lookalike')
  lookalike(@CurrentUser() user: AuthUser, @Body() dto: CreateLookalikeDto): Promise<AdAudience> {
    return this.service.createLookalike(user.org_id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.service.archive(user.org_id, id);
  }
}
