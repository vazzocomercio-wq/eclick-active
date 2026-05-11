import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export class UpdateOrgDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(2, 60)
  @Matches(SLUG_REGEX, {
    message: 'slug deve ter apenas letras minúsculas, números e hífens',
  })
  slug?: string;

  /**
   * Mergeado em `organizations.settings` (jsonb). Ex: shape conhecido
   * `{ auto_create_deal: { enabled, pipeline_id, stage_id, ai_position } }`.
   * Validação fina é responsabilidade do consumidor (lê com tolerância).
   */
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class UpdateAiFeatureDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

/**
 * Credenciais de LLM por org. Tudo opcional pra permitir patches parciais
 * (ex: só trocar modelo mantendo a chave). Quando provider muda, api_key
 * é obrigatória — a service valida.
 */
export class UpdateLlmCredentialsDto {
  @IsOptional()
  @IsString()
  @IsIn(['anthropic', 'openai', 'google'])
  provider?: 'anthropic' | 'openai' | 'google';

  @IsOptional()
  @IsString()
  @Length(1, 120)
  model?: string;

  @IsOptional()
  @IsString()
  @Length(10, 500)
  api_key?: string;
}

/**
 * Orçamento mensal de IA por org. Todos os campos opcionais — patch parcial
 * suportado. `monthly_budget_usd: null` remove o cap (volta pra telemetria).
 */
export class UpdateAiBudgetDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  monthly_budget_usd?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  alert_threshold_pct?: number;

  @IsOptional()
  @IsBoolean()
  hard_cap?: boolean;
}
