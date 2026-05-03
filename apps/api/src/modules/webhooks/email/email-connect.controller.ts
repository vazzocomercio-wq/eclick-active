import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { EmailProvider } from '../../../common/channels/providers/email/email.provider';
import { encryptToken } from '../../calendar-integrations/crypto.helper';
import { EmailPollerService } from './email-poller.service';

const PRESETS = ['gmail', 'outlook', 'yahoo', 'custom'] as const;

class ConnectEmailDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(1, 200)
  password!: string;

  @IsString()
  @Length(1, 100)
  display_name!: string;

  @IsOptional()
  @IsIn(PRESETS)
  preset?: (typeof PRESETS)[number];

  @IsOptional()
  @IsString()
  smtp_host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  smtp_port?: number;

  @IsOptional()
  @IsString()
  imap_host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  imap_port?: number;

  @IsOptional()
  @IsBoolean()
  imap_tls?: boolean;

  @IsOptional()
  @IsString()
  folder?: string;

  @IsOptional()
  @IsBoolean()
  use_template?: boolean;
}

const PRESET_CONFIG: Record<
  (typeof PRESETS)[number],
  { smtp_host: string; smtp_port: number; imap_host: string; imap_port: number; imap_tls: boolean }
> = {
  gmail: {
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    imap_host: 'imap.gmail.com',
    imap_port: 993,
    imap_tls: true,
  },
  outlook: {
    smtp_host: 'smtp-mail.outlook.com',
    smtp_port: 587,
    imap_host: 'outlook.office365.com',
    imap_port: 993,
    imap_tls: true,
  },
  yahoo: {
    smtp_host: 'smtp.mail.yahoo.com',
    smtp_port: 465,
    imap_host: 'imap.mail.yahoo.com',
    imap_port: 993,
    imap_tls: true,
  },
  custom: {
    smtp_host: '',
    smtp_port: 587,
    imap_host: '',
    imap_port: 993,
    imap_tls: true,
  },
};

@UseGuards(AuthGuard)
@Controller('channels/email')
export class EmailConnectController {
  private readonly logger = new Logger(EmailConnectController.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly emailProvider: EmailProvider,
    private readonly poller: EmailPollerService,
  ) {}

  /**
   * Testa credenciais sem salvar — usado pelo botão "Testar conexão"
   * antes do "Conectar".
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  async test(
    @CurrentUser() _user: AuthUser,
    @Body() dto: ConnectEmailDto,
  ): Promise<{ ok: boolean; error?: string; details?: Record<string, unknown> }> {
    const config = this.resolvePreset(dto);
    const encryptedPwd = encryptToken(dto.password);
    if (!encryptedPwd) {
      return { ok: false, error: 'Falha ao criptografar senha (ENCRYPTION_KEY ausente?)' };
    }

    const result = await this.emailProvider.validateCredentials({
      email: dto.email,
      password_encrypted: encryptedPwd,
      display_name: dto.display_name,
      smtp_host: config.smtp_host,
      smtp_port: config.smtp_port,
      imap_host: config.imap_host,
      imap_port: config.imap_port,
      imap_tls: config.imap_tls,
      folder: dto.folder ?? 'INBOX',
    } as never);

    return {
      ok: result.valid,
      ...(result.error ? { error: result.error } : {}),
      ...(result.details ? { details: result.details } : {}),
    };
  }

  /**
   * Conecta canal de email — valida credenciais + cria channel +
   * inicia polling.
   */
  @Post('connect')
  @HttpCode(HttpStatus.CREATED)
  async connect(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConnectEmailDto,
  ): Promise<{ channel_id: string }> {
    const config = this.resolvePreset(dto);
    const encryptedPwd = encryptToken(dto.password);
    if (!encryptedPwd) {
      throw new Error('Falha ao criptografar senha');
    }

    const credentials = {
      email: dto.email,
      password_encrypted: encryptedPwd,
      display_name: dto.display_name,
      smtp_host: config.smtp_host,
      smtp_port: config.smtp_port,
      imap_host: config.imap_host,
      imap_port: config.imap_port,
      imap_tls: config.imap_tls,
      folder: dto.folder ?? 'INBOX',
      use_template: dto.use_template ?? true,
    };

    // Valida antes de salvar
    const valid = await this.emailProvider.validateCredentials(credentials as never);
    if (!valid.valid) {
      throw new Error(`Credenciais inválidas: ${valid.error}`);
    }

    // Verifica se já existe canal pra esse email na org (evita duplicata)
    const { data: existing } = await this.supabase.adminClient
      .from('channels')
      .select('id')
      .eq('org_id', user.org_id)
      .eq('channel_type', 'email')
      .filter('credentials->>email', 'eq', dto.email)
      .maybeSingle();

    let channelId: string;
    if ((existing as { id: string } | null)?.id) {
      // Atualiza credenciais
      channelId = (existing as { id: string }).id;
      await this.supabase.adminClient
        .from('channels')
        .update({
          credentials,
          status: 'active',
          name: `${dto.display_name} <${dto.email}>`,
        })
        .eq('id', channelId);
    } else {
      const { data: created, error } = await this.supabase.adminClient
        .from('channels')
        .insert({
          org_id: user.org_id,
          channel_type: 'email',
          provider: 'smtp_imap',
          name: `${dto.display_name} <${dto.email}>`,
          credentials,
          status: 'active',
          config: {},
        })
        .select('id')
        .single();
      if (error || !created) {
        throw new Error(`Falha ao criar canal: ${error?.message}`);
      }
      channelId = (created as { id: string }).id;
    }

    // Inicia polling imediato (true = primeira vez, importa últimos 7 dias)
    this.poller.startPolling(channelId, true);

    return { channel_id: channelId };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    // Para polling antes de remover
    this.poller.stopPolling(id);
    const { error } = await this.supabase.adminClient
      .from('channels')
      .delete()
      .eq('org_id', user.org_id)
      .eq('id', id)
      .eq('channel_type', 'email');
    if (error) throw new Error(error.message);
  }

  private resolvePreset(dto: ConnectEmailDto): {
    smtp_host: string;
    smtp_port: number;
    imap_host: string;
    imap_port: number;
    imap_tls: boolean;
  } {
    if (dto.preset && dto.preset !== 'custom') {
      return PRESET_CONFIG[dto.preset];
    }
    return {
      smtp_host: dto.smtp_host ?? '',
      smtp_port: dto.smtp_port ?? 587,
      imap_host: dto.imap_host ?? '',
      imap_port: dto.imap_port ?? 993,
      imap_tls: dto.imap_tls ?? true,
    };
  }
}
