import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * DTO mínimo pra validar o payload de webhook da Z-API.
 *
 * **Importante**: aplicado com ValidationPipe `whitelist: false` (override do
 * global) — campos não declarados aqui passam pelo `@Body` sem ser strippados.
 * O ZapiProvider depois faz parse completo via `ZapiInboundPayload`.
 */
export class ZapiWebhookPayloadDto {
  @IsString()
  instanceId!: string;

  @IsString()
  type!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsBoolean()
  isGroup?: boolean;

  @IsOptional()
  @IsString()
  messageId?: string;

  @IsOptional()
  @IsString()
  senderName?: string;

  /** Pode vir string (URL) ou null. Sem decorator pra aceitar ambos. */
  @IsOptional()
  photo?: string | null;

  @IsOptional()
  @IsObject()
  message?: Record<string, unknown>;

  /** Pode vir number (Unix ts) ou string. */
  @IsOptional()
  momment?: number | string;
}
