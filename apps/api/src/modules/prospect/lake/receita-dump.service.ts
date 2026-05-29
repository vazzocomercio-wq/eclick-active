import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { DriveClient } from '../drive/drive.client';

/**
 * Worker do CNPJ Data Lake — DL.2.a (detector + manifest)
 *
 * Detecta o dump mensal mais recente da Receita Federal, lista arquivos
 * disponíveis, grava manifest JSON no Drive e telemetria em Postgres.
 *
 * URL base do dump (mudou de servidor algumas vezes; atual em 2026):
 *   https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/
 *
 * Estrutura típica:
 *   {YYYY-MM}/
 *     Empresas0.zip ... 9.zip          (~1GB cada)
 *     Estabelecimentos0.zip ... 9.zip  (~250MB cada)
 *     Socios0.zip ... 9.zip            (~100MB cada)
 *     Cnaes.zip, Naturezas.zip, ...    (tabelas auxiliares)
 *
 * ⚠️ DL.2.a NÃO faz o processing pesado — só detecta e cataloga.
 * DL.2.b implementa download → unzip → parse → index em `prospect_cnpj_index`.
 */

const RECEITA_BASE = 'https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj';

const DUMP_FILES = [
  ...Array.from({ length: 10 }, (_, i) => `Empresas${i}.zip`),
  ...Array.from({ length: 10 }, (_, i) => `Estabelecimentos${i}.zip`),
  ...Array.from({ length: 10 }, (_, i) => `Socios${i}.zip`),
  'Cnaes.zip',
  'Motivos.zip',
  'Municipios.zip',
  'Naturezas.zip',
  'Paises.zip',
  'Qualificacoes.zip',
  'Simples.zip',
];

interface ManifestFile {
  filename: string;
  url: string;
  size_bytes: number | null;
  last_modified: string | null;
  exists: boolean;
  http_status: number;
}

export interface ReceitaManifest {
  generated_at: string;
  month: string;
  base_url: string;
  total_files: number;
  total_files_available: number;
  total_size_bytes: number;
  files: ManifestFile[];
}

export interface ReceitaDumpResult {
  ok: boolean;
  month: string | null;
  manifest_drive_file_id: string | null;
  manifest_web_view_link: string | null;
  total_files_available: number;
  total_size_bytes: number;
  total_size_mb: number;
  total_size_gb: number;
  run_id: string;
  error?: string;
}

@Injectable()
export class ReceitaDumpService {
  private readonly log = new Logger(ReceitaDumpService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly drive: DriveClient,
  ) {}

  private get db() {
    return this.supabase.adminClient;
  }

  /**
   * Detecta último mês disponível tentando últimos 4 meses (mês atual + 3
   * anteriores) via HEAD em `Empresas0.zip`. Retorna YYYY-MM mais recente.
   */
  private async detectLatestMonth(): Promise<string | null> {
    const now = new Date();
    for (let i = 0; i < 4; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const month = `${yyyy}-${mm}`;
      const probeUrl = `${RECEITA_BASE}/${month}/Empresas0.zip`;
      try {
        const res = await fetch(probeUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok || res.status === 200) {
          this.log.log(`[receita-dump] detectado mês mais recente: ${month}`);
          return month;
        }
      } catch (e) {
        this.log.warn(`[receita-dump] probe ${month} falhou: ${(e as Error).message}`);
      }
    }
    return null;
  }

  private async probeFile(url: string): Promise<{ size: number | null; lastModified: string | null; status: number }> {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(15_000),
      });
      const size = res.headers.get('content-length');
      const lm = res.headers.get('last-modified');
      return {
        size: size ? Number(size) : null,
        lastModified: lm,
        status: res.status,
      };
    } catch {
      return { size: null, lastModified: null, status: 0 };
    }
  }

  /**
   * Roda DL.2.a — detecta mês, monta manifest, sobe pro Drive, grava run.
   *
   * @param overrideMonth opcional, força mês específico (YYYY-MM).
   */
  async runDL2a(overrideMonth?: string): Promise<ReceitaDumpResult> {
    // 1) Grava run em status='running'
    const { data: runInsert, error: runErr } = await this.db
      .from('prospect_lake_runs')
      .insert({
        source_id: 'receita_aberta',
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (runErr || !runInsert) {
      return {
        ok: false,
        month: null,
        manifest_drive_file_id: null,
        manifest_web_view_link: null,
        total_files_available: 0,
        total_size_bytes: 0,
        total_size_mb: 0,
        total_size_gb: 0,
        run_id: '',
        error: `lake_runs insert falhou: ${runErr?.message ?? 'unknown'}`,
      };
    }
    const runId = (runInsert as { id: string }).id;

    try {
      // 2) Detecta mês
      const month = overrideMonth ?? (await this.detectLatestMonth());
      if (!month) {
        await this.markFailed(runId, 'Não detectou mês disponível no servidor da Receita');
        return {
          ok: false,
          month: null,
          manifest_drive_file_id: null,
          manifest_web_view_link: null,
          total_files_available: 0,
          total_size_bytes: 0,
          total_size_mb: 0,
          total_size_gb: 0,
          run_id: runId,
          error: 'no_month_detected',
        };
      }

      // 3) Sonda cada arquivo (HEAD) — paralelo em batches de 10
      this.log.log(`[receita-dump] sondando ${DUMP_FILES.length} arquivos em ${month}…`);
      const files: ManifestFile[] = [];
      const batchSize = 10;
      for (let i = 0; i < DUMP_FILES.length; i += batchSize) {
        const batch = DUMP_FILES.slice(i, i + batchSize);
        const probes = await Promise.all(
          batch.map(async (filename) => {
            const url = `${RECEITA_BASE}/${month}/${filename}`;
            const probe = await this.probeFile(url);
            return {
              filename,
              url,
              size_bytes: probe.size,
              last_modified: probe.lastModified,
              http_status: probe.status,
              exists: probe.status === 200,
            };
          }),
        );
        files.push(...probes);
      }

      const availableCount = files.filter((f) => f.exists).length;
      const totalSize = files.reduce((sum, f) => sum + (f.size_bytes ?? 0), 0);

      const manifest: ReceitaManifest = {
        generated_at: new Date().toISOString(),
        month,
        base_url: `${RECEITA_BASE}/${month}`,
        total_files: files.length,
        total_files_available: availableCount,
        total_size_bytes: totalSize,
        files,
      };

      // 4) Sobe manifest pro Drive na subpasta `receita/`
      const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8');
      const receitaFolderId = await this.drive.ensureSubfolder('receita');
      const driveFile = await this.drive.upload(
        `manifest-${month}.json`,
        manifestBuffer,
        'application/json',
        receitaFolderId,
      );

      // 5) Atualiza run com sucesso
      await this.db
        .from('prospect_lake_runs')
        .update({
          status: 'done',
          finished_at: new Date().toISOString(),
          rows_processed: 0,
          bytes_uploaded: manifestBuffer.length,
          drive_file_id: driveFile.id,
          drive_file_path: `receita/manifest-${month}.json`,
        })
        .eq('id', runId);

      this.log.log(
        `[receita-dump] DL.2.a OK month=${month} arquivos=${availableCount}/${files.length} ` +
          `total=${(totalSize / 1024 / 1024 / 1024).toFixed(2)}GB drive=${driveFile.id}`,
      );

      return {
        ok: true,
        month,
        manifest_drive_file_id: driveFile.id,
        manifest_web_view_link: driveFile.webViewLink ?? null,
        total_files_available: availableCount,
        total_size_bytes: totalSize,
        total_size_mb: Math.round(totalSize / 1024 / 1024),
        total_size_gb: Number((totalSize / 1024 / 1024 / 1024).toFixed(2)),
        run_id: runId,
      };
    } catch (e) {
      const msg = (e as Error).message;
      this.log.error(`[receita-dump] falhou: ${msg}`);
      await this.markFailed(runId, msg);
      return {
        ok: false,
        month: null,
        manifest_drive_file_id: null,
        manifest_web_view_link: null,
        total_files_available: 0,
        total_size_bytes: 0,
        total_size_mb: 0,
        total_size_gb: 0,
        run_id: runId,
        error: msg,
      };
    }
  }

  private async markFailed(runId: string, msg: string): Promise<void> {
    await this.db
      .from('prospect_lake_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: msg,
      })
      .eq('id', runId);
  }

  /** Lista runs recentes (pra UI admin). */
  async listRuns(limit = 20) {
    const { data, error } = await this.db
      .from('prospect_lake_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return data ?? [];
  }
}
