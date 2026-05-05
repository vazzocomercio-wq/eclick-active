import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import type { AIFeatureName } from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  SettingsService,
  type AiFeature,
  type LlmCredentials,
  type OrgSettings,
} from './settings.service';
import {
  UpdateAiFeatureDto,
  UpdateLlmCredentialsDto,
  UpdateOrgDto,
} from './dto/settings.dto';

const VALID_FEATURE_NAMES: AIFeatureName[] = [
  'auto_classify',
  'suggest_response',
  'auto_respond',
  'summarize',
  'sentiment',
  'lead_scoring',
  'copilot',
  'audit',
  'follow_up_agent',
  'train_agent',
];

@UseGuards(AuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  // ────────────────────────────────────────────
  // ORG
  // ────────────────────────────────────────────

  @Get('org')
  getOrg(@CurrentUser() user: AuthUser): Promise<OrgSettings> {
    return this.service.getOrg(user.org_id);
  }

  @Patch('org')
  updateOrg(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateOrgDto,
  ): Promise<OrgSettings> {
    return this.service.updateOrg(user.org_id, user.role, dto);
  }

  // ────────────────────────────────────────────
  // AI features
  // ────────────────────────────────────────────

  @Get('ai')
  getAi(@CurrentUser() user: AuthUser): Promise<AiFeature[]> {
    return this.service.getAiFeatures(user.org_id);
  }

  @Patch('ai/:featureName')
  @HttpCode(HttpStatus.OK)
  updateAi(
    @CurrentUser() user: AuthUser,
    @Param('featureName') featureName: string,
    @Body() dto: UpdateAiFeatureDto,
  ): Promise<AiFeature> {
    if (!VALID_FEATURE_NAMES.includes(featureName as AIFeatureName)) {
      throw new Error(`Feature desconhecida: ${featureName}`);
    }
    return this.service.upsertAiFeature(
      user.org_id,
      user.role,
      featureName as AIFeatureName,
      dto,
    );
  }

  // ────────────────────────────────────────────
  // LLM credentials (provider/model/api_key por org)
  // ────────────────────────────────────────────

  @Get('llm')
  getLlm(@CurrentUser() user: AuthUser): Promise<LlmCredentials> {
    return this.service.getLlmCredentials(user.org_id);
  }

  @Patch('llm')
  @HttpCode(HttpStatus.OK)
  updateLlm(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateLlmCredentialsDto,
  ): Promise<LlmCredentials> {
    return this.service.updateLlmCredentials(user.org_id, user.role, dto);
  }
}
