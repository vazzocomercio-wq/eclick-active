import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { SlackNotifierService } from './slack-notifier.service';

@UseGuards(AuthGuard)
@Controller('slack-webhooks')
export class SlackController {
  constructor(private readonly slack: SlackNotifierService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.slack.list(user.org_id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      name: string;
      webhook_url: string;
      channel_name?: string;
      notify_social?: boolean;
      notify_ad?: boolean;
      notify_sac?: boolean;
      min_severity?: 'info' | 'warning' | 'critical';
    },
  ) {
    return this.slack.create(user.org_id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.slack.update(user.org_id, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.slack.delete(user.org_id, id);
  }

  @Post(':id/test')
  test(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.slack.testWebhook(user.org_id, id);
  }
}
