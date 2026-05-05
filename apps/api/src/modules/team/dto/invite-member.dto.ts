import {
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { OrgMemberRole } from '@eclick-active/shared';

const INVITABLE_ROLES: OrgMemberRole[] = ['admin', 'manager', 'agent', 'viewer'];
const ALL_ROLES: OrgMemberRole[] = [
  'owner',
  'admin',
  'manager',
  'agent',
  'viewer',
];

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  /** owner não pode ser convidado — só promovido manualmente em SQL. */
  @IsIn(INVITABLE_ROLES)
  role!: OrgMemberRole;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  display_name?: string;
}

export class UpdateMemberDto {
  @IsOptional()
  @IsIn(ALL_ROLES)
  role?: OrgMemberRole;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  workspace_ids?: string[];

  @IsOptional()
  @IsString()
  @Length(1, 120)
  display_name?: string;

  /**
   * Especialidades/serviços que o profissional atende. Texto livre por org
   * — clínica ('nutricionista'), salão ('corte', 'manicure'), oficina,
   * B2B etc. IA do Concierge usa pra match com mensagem do cliente.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  specialties?: string[];

  /**
   * Duração padrão por atendimento (em minutos). Sistema calcula slots
   * livres dividindo a janela de availability por essa duração. NULL =
   * usa appointment_type.duration_minutes (legado).
   */
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  default_duration_minutes?: number | null;

  /**
   * Tempo entre atendimentos (limpeza/intervalo). Default 0.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  default_buffer_minutes?: number;
}
