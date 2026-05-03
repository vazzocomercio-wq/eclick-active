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
  ChannelsService,
  type ChannelView,
  type WhatsAppFreeDiagnostics,
} from './channels.service';
import {
  CreateChannelDto,
  UpdateChannelDto,
} from './dto/create-channel.dto';
import { EventsGateway } from '../../gateways/events.gateway';

@UseGuards(AuthGuard)
@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly service: ChannelsService,
    private readonly events: EventsGateway,
  ) {}

  /**
   * Diagnóstico do pipeline WhatsApp Gratuito (Baileys).
   * Retorna estado dos canais + sockets conectados + presença de envs
   * pra ajudar a debugar quando o QR não chega.
   *
   * IMPORTANTE: Esse endpoint precisa vir ANTES do `:id` pra não cair
   * no ParseUUIDPipe.
   */
  @Get('diagnostics/whatsapp-free')
  async diagnostics(
    @CurrentUser() user: AuthUser,
  ): Promise<WhatsAppFreeDiagnostics & { sockets_connected: number }> {
    const data = await this.service.getWhatsAppFreeDiagnostics(user.org_id);
    const sockets_connected = this.events.countSocketsForOrg(user.org_id);
    return { ...data, sockets_connected };
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ChannelView[]> {
    return this.service.list(user.org_id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateChannelDto,
  ): Promise<ChannelView> {
    return this.service.create(user.org_id, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChannelView> {
    return this.service.findById(user.org_id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChannelDto,
  ): Promise<ChannelView> {
    return this.service.update(user.org_id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.delete(user.org_id, id);
  }
}
