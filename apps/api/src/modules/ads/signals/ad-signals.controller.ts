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
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  DetectorRunResult,
  SignalDetectorService,
} from './signal-detector.service';

class AckSignalDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

interface AdSignalListItem {
  id: string;
  signal_type: string;
  metric_key: string | null;
  severity: string;
  current_value: number | null;
  threshold_value: number | null;
  payload: Record<string, unknown>;
  status: string;
  generated_at: string;
  sent_at: string | null;
  ack_at: string | null;
  campaign: { id: string; name: string; platform: string } | null;
}

@UseGuards(AuthGuard)
@Controller('ad-signals')
export class AdSignalsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly detector: SignalDetectorService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<AdSignalListItem[]> {
    const limit = clampLimit(Number(limitRaw ?? 50));
    let query = this.supabase.adminClient
      .from('ad_signals')
      .select(
        'id, signal_type, metric_key, severity, current_value, threshold_value, payload, status, generated_at, sent_at, ack_at, campaign:ad_campaigns(id, name, platform)',
      )
      .eq('org_id', user.org_id)
      .order('generated_at', { ascending: false })
      .limit(limit);

    if (status && ['pending', 'sent', 'acked', 'expired'].includes(status)) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Falha ao listar sinais: ${error.message}`);
    }
    // Supabase devolve `campaign` como array em joins de FK — flatten
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      signal_type: r.signal_type as string,
      metric_key: (r.metric_key as string | null) ?? null,
      severity: r.severity as string,
      current_value: (r.current_value as number | null) ?? null,
      threshold_value: (r.threshold_value as number | null) ?? null,
      payload: (r.payload as Record<string, unknown>) ?? {},
      status: r.status as string,
      generated_at: r.generated_at as string,
      sent_at: (r.sent_at as string | null) ?? null,
      ack_at: (r.ack_at as string | null) ?? null,
      campaign: flattenCampaign(r.campaign),
    }));
  }

  /**
   * Marca signal como acked (user revisou). Não envia notif.
   * Permission: qualquer membro autenticado da org.
   */
  @Post(':id/ack')
  @HttpCode(HttpStatus.OK)
  async ack(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AckSignalDto,
  ): Promise<{ ok: true }> {
    const { error } = await this.supabase.adminClient
      .from('ad_signals')
      .update({
        status: 'acked',
        ack_at: new Date().toISOString(),
        acked_by: user.id,
        ...(dto.note ? { payload: { ack_note: dto.note } } : {}),
      })
      .eq('id', id)
      .eq('org_id', user.org_id);
    if (error) {
      throw new Error(`Falha ao marcar como visto: ${error.message}`);
    }
    return { ok: true };
  }

  /**
   * Trigger manual da detecção. Útil pra testar/seedar primeiros
   * sinais sem esperar 15min do worker.
   */
  @Post('detect')
  @HttpCode(HttpStatus.OK)
  detect(@CurrentUser() user: AuthUser): Promise<DetectorRunResult> {
    return this.detector.runForOrg(user.org_id);
  }
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(Math.max(1, Math.floor(n)), 200);
}

function flattenCampaign(
  raw: unknown,
): { id: string; name: string; platform: string } | null {
  if (!raw) return null;
  // Supabase retorna como array em joins; pega o primeiro
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (!candidate || typeof candidate !== 'object') return null;
  const c = candidate as { id?: string; name?: string; platform?: string };
  if (!c.id) return null;
  return {
    id: c.id,
    name: c.name ?? '(sem nome)',
    platform: c.platform ?? 'meta',
  };
}
