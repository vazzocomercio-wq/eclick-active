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
import type { WebhookDelivery, WebhookEndpoint } from '@eclick-active/shared';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { OutboundWebhookService } from './outbound-webhook.service';
import {
  CreateWebhookEndpointDto,
  UpdateWebhookEndpointDto,
} from './dto/webhook-endpoint.dto';

@UseGuards(AuthGuard)
@Controller('webhooks')
export class OutboundWebhookController {
  constructor(private readonly service: OutboundWebhookService) {}

  // ──────────────────────────────────────────────────────────
  // Deliveries (rotas estáticas antes das dinâmicas)
  // ──────────────────────────────────────────────────────────

  // POST /webhooks/deliveries/:id/retry
  @Post('deliveries/:id/retry')
  @HttpCode(HttpStatus.OK)
  retryDelivery(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WebhookDelivery> {
    return this.service.retryDelivery(user.org_id, id);
  }

  // ──────────────────────────────────────────────────────────
  // Endpoints CRUD
  // ──────────────────────────────────────────────────────────

  @Get('endpoints')
  list(@CurrentUser() user: AuthUser): Promise<WebhookEndpoint[]> {
    return this.service.list(user.org_id);
  }

  @Post('endpoints')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWebhookEndpointDto,
  ): Promise<WebhookEndpoint> {
    return this.service.create(user.org_id, dto);
  }

  @Patch('endpoints/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookEndpointDto,
  ): Promise<WebhookEndpoint> {
    return this.service.update(user.org_id, id, dto);
  }

  @Delete('endpoints/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(user.org_id, id);
  }

  @Post('endpoints/:id/test')
  @HttpCode(HttpStatus.OK)
  test(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WebhookDelivery> {
    return this.service.test(user.org_id, id);
  }

  @Get('endpoints/:id/deliveries')
  deliveries(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WebhookDelivery[]> {
    return this.service.getDeliveries(user.org_id, id);
  }
}
