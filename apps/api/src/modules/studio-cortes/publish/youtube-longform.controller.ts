import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { YouTubeLongformService } from './youtube-longform.service';
import type { GenerateDraftDto, UpdateDraftDto } from './youtube-longform.types';

/**
 * Publicação de VÍDEO LONGO no YouTube (fecha o ciclo do Radar). Gera rascunho
 * (metadados IA + miniatura), permite editar e publica por ação explícita.
 */
@UseGuards(AuthGuard)
@Controller('studio-cortes/youtube/longform')
export class YouTubeLongformController {
  constructor(private readonly service: YouTubeLongformService) {}

  /** Gera (ou recupera) o rascunho de publicação a partir de um vídeo HeyGen. */
  @Post('draft')
  @HttpCode(HttpStatus.CREATED)
  draft(@CurrentUser() user: AuthUser, @Body() body: GenerateDraftDto) {
    if (!body?.heygen_job_id && !body?.source_video_url) {
      throw new BadRequestException('Informe heygen_job_id ou source_video_url.');
    }
    return this.service.generateDraft(user.org_id, body);
  }

  @Get('publications')
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.org_id);
  }

  @Get('publications/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user.org_id, id);
  }

  @Patch('publications/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDraftDto,
  ) {
    return this.service.updateDraft(user.org_id, id, body);
  }

  /** Regenera só a miniatura (fundo IA + avatar + título). */
  @Post('publications/:id/thumbnail')
  thumbnail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.regenerateThumbnail(user.org_id, id);
  }

  /** Publica no YouTube (ação explícita do usuário — sobe o vídeo + capa). */
  @Post('publications/:id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { channel_cred_id?: string | null },
  ) {
    return this.service.publish(user.org_id, id, body?.channel_cred_id ?? null);
  }
}
