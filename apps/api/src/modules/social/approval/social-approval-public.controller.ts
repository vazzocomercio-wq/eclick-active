import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { SocialApprovalService } from './social-approval.service';

/**
 * Endpoints PÚBLICOS de review — não exigem auth, autorização via
 * access_token único de 64 chars no path. Cada token aponta pra
 * 1 stage específico de 1 content.
 *
 * Mounted em /public/social/approval pra distinção clara dos
 * endpoints autenticados em /social/approval.
 */
@Controller('public/social/approval')
export class SocialApprovalPublicController {
  constructor(private readonly approval: SocialApprovalService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.approval.getByToken(token);
  }

  @Post(':token/decide')
  decide(
    @Param('token') token: string,
    @Body() body: { decision: 'approved' | 'rejected'; notes?: string },
  ) {
    return this.approval.decide(token, body.decision, body.notes);
  }
}
