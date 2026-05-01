import { IsIn, IsObject } from 'class-validator';

export type ReportType = 'sales' | 'agents' | 'channels' | 'funnel';

export class InterpretReportDto {
  @IsIn(['sales', 'agents', 'channels', 'funnel'])
  report_type!: ReportType;

  /** Os dados crus do relatório (qualquer shape válido). */
  @IsObject()
  data!: Record<string, unknown>;
}
