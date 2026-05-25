import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Param,
  Query,
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
import { SocialKnowledgeService } from './social-knowledge.service';

/** Estúdio de Estilos — editor de prompts + base de conhecimento. */
@UseGuards(AuthGuard)
@Controller('social')
export class SocialPromptsController {
  constructor(
    private readonly prompts: SocialPromptsService,
    private readonly knowledge: SocialKnowledgeService,
  ) {}

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

  // ─── Base de conhecimento (B2) ──────────────────

  @Get('knowledge')
  listKnowledge(@CurrentUser() user: AuthUser, @Query('scope') scope?: string) {
    return this.knowledge.list(user.org_id, scope);
  }

  @Post('knowledge')
  addKnowledge(
    @CurrentUser() user: AuthUser,
    @Body() dto: { scope?: string; source_type: 'image' | 'url'; value: string; title?: string },
  ) {
    return this.knowledge.add(user.org_id, dto);
  }

  @Delete('knowledge/:id')
  removeKnowledge(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.knowledge.remove(user.org_id, id).then(() => ({ ok: true }));
  }
}
