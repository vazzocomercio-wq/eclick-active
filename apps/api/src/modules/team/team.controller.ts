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
  TeamService,
  type MemberStats,
  type MemberView,
} from './team.service';
import {
  InviteMemberDto,
  UpdateMemberDto,
} from './dto/invite-member.dto';

@UseGuards(AuthGuard)
@Controller('team')
export class TeamController {
  constructor(private readonly service: TeamService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<MemberView[]> {
    return this.service.getMembers(user.org_id);
  }

  @Post('invite')
  @HttpCode(HttpStatus.CREATED)
  invite(
    @CurrentUser() user: AuthUser,
    @Body() dto: InviteMemberDto,
  ): Promise<MemberView> {
    return this.service.inviteMember(user.org_id, user.role, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<MemberView> {
    return this.service.updateMember(user.org_id, user.role, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.removeMember(user.org_id, user.role, user.id, id);
  }

  @Get(':id/stats')
  stats(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MemberStats> {
    return this.service.getMemberStats(user.org_id, id);
  }
}
