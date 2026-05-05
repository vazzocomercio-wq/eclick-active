import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, Length } from 'class-validator';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { SupabaseService } from '../../common/supabase/supabase.service';

class AckDeliveryDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

interface AlertDeliveryListItem {
  id: string;
  manager_id: string;
  manager_name: string | null;
  signal_id: string | null;
  signals_batch: string[];
  delivery_mode: string;
  message_text: string | null;
  status: string;
  narrator: string;
  retry_count: number;
  channel_message_id: string | null;
  error_message: string | null;
  generated_at: string;
  sent_at: string | null;
  ack_at: string | null;
}

@UseGuards(AuthGuard)
@Controller('alert-deliveries')
export class AlertDeliveriesController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('manager_id') managerId?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<AlertDeliveryListItem[]> {
    const limit = clampLimit(Number(limitRaw ?? 100));
    let q = this.supabase.adminClient
      .from('alert_deliveries')
      .select(
        `id, manager_id, signal_id, signals_batch, delivery_mode,
         message_text, status, narrator, retry_count, channel_message_id,
         error_message, generated_at, sent_at, ack_at,
         manager:alert_managers(id, name)`,
      )
      .eq('org_id', user.org_id)
      .order('generated_at', { ascending: false })
      .limit(limit);

    if (status && ['pending', 'queued', 'sent', 'failed', 'acked'].includes(status)) {
      q = q.eq('status', status);
    }
    if (managerId) {
      q = q.eq('manager_id', managerId);
    }

    const { data, error } = await q;
    if (error) {
      throw new Error(`Falha ao listar deliveries: ${error.message}`);
    }

    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const mgrRaw = r.manager;
      const mgr = Array.isArray(mgrRaw) ? mgrRaw[0] : mgrRaw;
      return {
        id: r.id as string,
        manager_id: r.manager_id as string,
        manager_name: (mgr as { name?: string } | null | undefined)?.name ?? null,
        signal_id: (r.signal_id as string | null) ?? null,
        signals_batch: (r.signals_batch as string[]) ?? [],
        delivery_mode: r.delivery_mode as string,
        message_text: (r.message_text as string | null) ?? null,
        status: r.status as string,
        narrator: r.narrator as string,
        retry_count: (r.retry_count as number) ?? 0,
        channel_message_id: (r.channel_message_id as string | null) ?? null,
        error_message: (r.error_message as string | null) ?? null,
        generated_at: r.generated_at as string,
        sent_at: (r.sent_at as string | null) ?? null,
        ack_at: (r.ack_at as string | null) ?? null,
      };
    });
  }

  @Post(':id/ack')
  @HttpCode(HttpStatus.OK)
  async ack(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() _dto: AckDeliveryDto,
  ): Promise<{ ok: true }> {
    const { error } = await this.supabase.adminClient
      .from('alert_deliveries')
      .update({
        ack_at: new Date().toISOString(),
        acked_by: user.id,
        status: 'acked',
      })
      .eq('id', id)
      .eq('org_id', user.org_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  }
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(Math.max(1, Math.floor(n)), 500);
}
