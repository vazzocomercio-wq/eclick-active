import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import {
  SocialPromptsService,
  PromptKind,
  UpsertOverrideDto,
  GeneratePromptDto,
} from './social-prompts.service';

/** Estúdio de Estilos — editor de prompts (estilos/frameworks/system prompts). */
@UseGuards(AuthGuard)
@Controller('social')
export class SocialPromptsController {
  constructor(private readonly prompts: SocialPromptsService) {}

  @Get('prompts')
  list(@CurrentUser() user: AuthUser) {
    return this.prompts.list(user.org_id);
  }

  @Put('prompts')
  upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertOverrideDto) {
    return this.prompts.upsert(user.org_id, dto);
  }

  @Post('prompts/generate')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GeneratePromptDto) {
    return this.prompts.generate(user.org_id, dto);
  }

  @Delete('prompts/:kind/:key')
  reset(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: PromptKind,
    @Param('key') key: string,
  ) {
    return this.prompts
      .reset(user.org_id, kind, decodeURIComponent(key))
      .then(() => ({ ok: true }));
  }
}
