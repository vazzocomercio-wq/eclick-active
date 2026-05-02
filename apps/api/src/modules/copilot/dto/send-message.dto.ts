import { IsIn, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

export type CopilotContextType = 'deal' | 'contact' | 'conversation' | 'general';

const CONTEXT_TYPES: CopilotContextType[] = ['deal', 'contact', 'conversation', 'general'];

export class SendMessageDto {
  @IsString()
  @Length(1, 4000)
  message!: string;

  /**
   * Quando setado, o backend faz lookup da entidade e adiciona um preâmbulo
   * de contexto à conversa antes de enviar pro modelo. Não altera o que é
   * persistido em copilot_messages.content — apenas o prompt do turn atual.
   */
  @IsOptional()
  @IsIn(CONTEXT_TYPES)
  context_type?: CopilotContextType;

  /** Obrigatório quando context_type não é 'general'. */
  @IsOptional()
  @ValidateIf((o: SendMessageDto) => o.context_type !== undefined && o.context_type !== 'general')
  @IsUUID()
  context_id?: string;
}
