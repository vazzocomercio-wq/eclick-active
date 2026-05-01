import {
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
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
}
