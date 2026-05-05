import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  AlertManagerPublic,
  AlertManagersService,
} from './alert-managers.service';
import {
  ConfirmPhoneDto,
  CreateAlertManagerDto,
  UpdateAlertManagerDto,
} from './alerts.dto';

@UseGuards(AuthGuard)
@Controller('alert-managers')
export class AlertManagersController {
  constructor(private readonly service: AlertManagersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AlertManagerPublic[]> {
    return this.service.list(user.org_id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAlertManagerDto,
  ): Promise<AlertManagerPublic> {
    return this.service.create(user.org_id, user.role, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAlertManagerDto,
  ): Promise<AlertManagerPublic> {
    return this.service.update(user.org_id, user.role, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.service.remove(user.org_id, user.role, id);
  }

  /**
   * Dispara envio do código de verificação via WhatsApp pro phone do
   * manager. Owner/admin only. Throttled a 1/min no service.
   */
  @Post(':id/verify-phone')
  @HttpCode(HttpStatus.OK)
  verifyPhone(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ ok: true; expires_in_minutes: number }> {
    return this.service.requestVerification(user.org_id, user.role, id);
  }

  /**
   * Manager (ou quem esteja olhando o WhatsApp) cola o código aqui pra
   * marcar status='active'. Sem permissão owner/admin — qualquer membro
   * autenticado da org pode confirmar (cenário comum: gerente colou o
   * código no chat com a pessoa que cadastrou).
   */
  @Post(':id/confirm-phone')
  @HttpCode(HttpStatus.OK)
  confirmPhone(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfirmPhoneDto,
  ): Promise<AlertManagerPublic> {
    return this.service.confirmPhone(user.org_id, id, dto.code);
  }
}
