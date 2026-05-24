import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { SocialCampaignRecipesService } from './social-campaign-recipes.service';
import { SocialCampaignService } from './social-campaign.service';
import type {
  UpsertRecipeDto,
  GenerateCampaignDto,
  GenerateBatchDto,
  GenerateLiveScriptDto,
} from './dto/campaign.dto';

/**
 * Autopilot de Campanha (Social Commerce AI — Fase 1).
 * Rotas sob /social: receitas (config) + campanhas (execução).
 */
@UseGuards(AuthGuard)
@Controller('social')
export class SocialCampaignController {
  constructor(
    private readonly recipes: SocialCampaignRecipesService,
    private readonly campaigns: SocialCampaignService,
  ) {}

  // ─── Receitas ───────────────────────────────────

  @Get('campaign-recipes')
  listRecipes(@CurrentUser() user: AuthUser) {
    return this.recipes.list(user.org_id);
  }

  /** Garante (ou cria) uma receita default pra org. */
  @Get('campaign-recipes/default')
  getDefaultRecipe(@CurrentUser() user: AuthUser) {
    return this.recipes.ensureDefault(user.org_id);
  }

  @Post('campaign-recipes')
  createRecipe(@CurrentUser() user: AuthUser, @Body() dto: UpsertRecipeDto) {
    return this.recipes.create(user.org_id, dto);
  }

  @Get('campaign-recipes/:id')
  getRecipe(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.recipes.get(user.org_id, id);
  }

  @Patch('campaign-recipes/:id')
  updateRecipe(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpsertRecipeDto,
  ) {
    return this.recipes.update(user.org_id, id, dto);
  }

  @Delete('campaign-recipes/:id')
  deleteRecipe(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.recipes.remove(user.org_id, id).then(() => ({ ok: true }));
  }

  // ─── Campanhas ──────────────────────────────────

  @Post('campaigns/generate')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateCampaignDto) {
    return this.campaigns.generateCampaign(user.org_id, dto);
  }

  /** Geração em lote: a IA escolhe os top-N produtos por estratégia comercial. */
  @Post('campaigns/generate-batch')
  generateBatch(@CurrentUser() user: AuthUser, @Body() dto: GenerateBatchDto) {
    return this.campaigns.generateBatch(user.org_id, dto);
  }

  @Get('campaigns')
  listCampaigns(@CurrentUser() user: AuthUser) {
    return this.campaigns.list(user.org_id);
  }

  @Get('campaigns/:id')
  getCampaign(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.getCampaign(user.org_id, id);
  }

  @Post('campaigns/:id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    // approved_by referencia org_members.id (≠ auth.users.id) → passa null
    return this.campaigns.approveCampaign(user.org_id, id, null);
  }

  @Post('campaigns/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.cancelCampaign(user.org_id, id);
  }

  /** Fan-out: cria rascunhos de anúncio (Meta) pras peças prontas. */
  @Post('campaigns/:id/ads')
  createAds(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.createAdDrafts(user.org_id, id, null);
  }

  /** Co-piloto de live: gera roteiro de live de vendas. */
  @Post('live/script')
  liveScript(@CurrentUser() user: AuthUser, @Body() dto: GenerateLiveScriptDto) {
    return this.campaigns.generateLiveScript(user.org_id, dto);
  }
}
