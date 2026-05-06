import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { SocialApprovalService } from './social-approval.service';

/**
 * Endpoints internos (com auth) pra criar/cancelar stages e listar
 * por content_id. Endpoint PÚBLICO de review está em
 * social-approval-public.controller.ts (sem auth).
 */
@UseGuards(AuthGuard)
@Controller('social/approval')
export class SocialApprovalController {
  constructor(private readonly approval: SocialApprovalService) {}

  @Get('content/:contentId')
  list(@CurrentUser() user: AuthUser, @Param('contentId') contentId: string) {
    return this.approval.listForContent(user.org_id, contentId);
  }

  @Post('content/:contentId')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('contentId') contentId: string,
    @Body()
    body: {
      reviewer_name: string;
      reviewer_email?: string;
      stage_label?: string;
      duration_days?: number;
    },
  ) {
    const stage = await this.approval.create(user.org_id, user.id, {
      content_id: contentId,
      reviewer_name: body.reviewer_name,
      reviewer_email: body.reviewer_email,
      stage_label: body.stage_label,
      duration_days: body.duration_days,
    });
    return {
      ...stage,
      public_url: this.approval.buildPublicUrl(stage.access_token),
    };
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.approval.cancel(user.org_id, id);
  }
}
