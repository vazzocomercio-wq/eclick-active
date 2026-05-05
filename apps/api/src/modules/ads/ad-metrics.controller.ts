import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  AdMetricCatalogEntry,
  AdPlatformFilter,
  MetricCatalogService,
} from './metric-catalog.service';
import {
  AdMetricConfig,
  AggregationWindow,
  MetricConfigService,
  ThresholdMode,
} from './metric-config.service';

class UpdateMetricConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['manual', 'auto'])
  threshold_mode?: ThresholdMode;

  @IsOptional()
  @IsNumber()
  target_value?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  warning_pct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  critical_pct?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  baseline_window_days?: number;

  @IsOptional()
  @IsString()
  @IsIn(['day', '7d', '30d'])
  aggregation_window?: AggregationWindow;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  routing_manager_ids?: string[];

  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string | null;
}

/**
 * Endpoints do catálogo + configs de métricas pra UI de
 * /configuracoes > Monitoramento. Usa AuthGuard pra exigir JWT.
 */
@UseGuards(AuthGuard)
@Controller('ad-metrics')
export class AdMetricsController {
  constructor(
    private readonly catalog: MetricCatalogService,
    private readonly config: MetricConfigService,
  ) {}

  // ────────────────────────────────────────────
  // Catálogo (read-only)
  // ────────────────────────────────────────────

  @Get('catalog')
  async listCatalog(
    @Query('platform') platform?: AdPlatformFilter,
  ): Promise<AdMetricCatalogEntry[]> {
    return this.catalog.list(platform ?? 'all');
  }

  // ────────────────────────────────────────────
  // Configs por org (lista + patch)
  // ────────────────────────────────────────────

  @Get('configs')
  async listConfigs(
    @CurrentUser() user: AuthUser,
    @Query('platform') platform?: 'meta' | 'google' | 'shared' | 'all',
  ): Promise<AdMetricConfig[]> {
    return this.config.list(user.org_id, platform ?? 'all');
  }

  @Patch('configs/:metricKey')
  @HttpCode(HttpStatus.OK)
  async updateConfig(
    @CurrentUser() user: AuthUser,
    @Param('metricKey') metricKey: string,
    @Body() dto: UpdateMetricConfigDto,
  ): Promise<AdMetricConfig> {
    return this.config.upsert(user.org_id, user.role, metricKey, dto);
  }
}
