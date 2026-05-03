import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO do "Iniciar conversa" — vendedor cadastra contato + escolhe canal +
 * primeira mensagem. Sistema cria conversation outbound + envia mensagem.
 *
 * Reutilizamos conversa existente (mesmo contato + mesmo canal + status
 * open/pending) em vez de duplicar.
 */
export class StartConversationDto {
  @IsUUID()
  contact_id!: string;

  @IsUUID()
  channel_id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  message!: string;

  @IsOptional()
  @IsIn(['text'])
  message_type?: 'text';

  /**
   * Se true, marca a mensagem como nota interna (não envia pelo provider,
   * só registra na conversa). Útil pro vendedor anotar antes de iniciar.
   */
  @IsOptional()
  @IsBoolean()
  is_internal_note?: boolean;
}
