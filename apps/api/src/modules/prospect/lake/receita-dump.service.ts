import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { DriveClient } from '../drive/drive.client';

/**
 * Worker do CNPJ Data Lake — DL.2.a (detector + manifest)
 *
 * Detecta o dump mensal mais recente da Receita Federal, lista arquivos
 * disponíveis, grava manifest JSON no Drive e telemetria em Postgres.
 *
 * ⚠️ MUDANÇA jan/2026: a RFB migrou os dados abertos pra um Nextcloud.
 * O antigo autoindex Apache em `…/dados_abertos_cnpj/{YYYY-MM}/` virou 404.
 * Agora os arquivos vivem num compartilhamento público (WebDAV):
 *   base:  https://arquivos.receitafederal.gov.br/public.php/webdav
 *   auth:  Basic (username = share token, password vazio)
 *   listar: PROPFIND Depth:1 → <d:response> com <d:href> + <d:getcontentlength>
 *
 * Estrutura típica de cada mês {YYYY-MM}/:
 *   Empresas0.zip ... 9.zip          (~500MB cada)
 *   Estabelecimentos0.zip ... 9.zip  (~80MB cada)
 *   Socios0.zip ... 9.zip            (~80MB cada)
 *   Cnaes.zip, Naturezas.zip, ...    (tabelas auxiliares)
 *
 * ⚠️ DL.2.a NÃO faz o processing pesado — só detecta e cataloga.
 * DL.2.b implementa download → unzip → parse → index em `prospect_cnpj_index`.
 */

const RECEITA_BASE =
  process.env.RECEITA_BASE_URL ?? 'https://arquivos.receitafederal.gov.br/public.php/webdav';

/**
 * Token do compartilhamento público da RFB. Configurável via env
 * (RECEITA_SHARE_TOKEN) pq a RFB já trocou o token algumas vezes.
 * Default = token vigente em mai/2026.
 */
const RECEITA_SHARE_TOKEN = process.env.RECEITA_SHARE_TOKEN ?? 'YggdBLfdninEJX9';

/** Arquivos de dados esperados num dump completo (cross-check de cobertura). */
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

  /** Header de auth básica do compartilhamento público (token:''). */
  private authHeader(): string {
    return `Basic ${Buffer.from(`${RECEITA_SHARE_TOKEN}:`).toString('base64')}`;
  }

  /**
   * PROPFIND (Depth:1) num path relativo ao compartilhamento.
   * Retorna o XML cru do Nextcloud WebDAV. path '' = raiz (lista os meses).
   */
  private async propfind(path = '', timeoutMs = 60_000): Promise<string> {
    const url = `${RECEITA_BASE}/${path}`.replace(/\/+$/, '') + '/';
    const res = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        Authorization: this.authHeader(),
        Depth: '1',
        'Content-Type': 'application/xml',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok && res.status !== 207) {
      throw new Error(`PROPFIND ${path || '/'} → HTTP ${res.status}`);
    }
    return res.text();
  }

  /**
   * Detecta o mês mais recente via PROPFIND na raiz do compartilhamento.
   * Os <d:href> trazem subpastas no padrão YYYY-MM; pega a maior.
   */
  private async detectLatestMonth(): Promise<string | null> {
    try {
      const xml = await this.propfind('');
      const months = Array.from(xml.matchAll(/(\d{4}-\d{2})\/?<\/d:href>/gi)).map((m) => m[1]!);
      const unique = Array.from(new Set(months)).sort();
      const latest = unique[unique.length - 1] ?? null;
      if (latest) this.log.log(`[receita-dump] detectado mês mais recente: ${latest}`);
      return latest;
    } catch (e) {
      this.log.warn(`[receita-dump] detectLatestMonth falhou: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Lista os arquivos de um mês via PROPFIND (1 request → todos os arquivos
   * com tamanho e last-modified). Substitui os ~36 HEADs do esquema antigo.
   */
  private async listMonthFiles(month: string): Promise<ManifestFile[]> {
    const xml = await this.propfind(month);
    const out: ManifestFile[] = [];
    // Cada item vem num bloco <d:response>…</d:response>.
    const blocks = xml.split(/<d:response>/i).slice(1);
    for (const block of blocks) {
      const hrefMatch = block.match(/<d:href>([^<]+)<\/d:href>/i);
      if (!hrefMatch) continue;
      const href = decodeURIComponent(hrefMatch[1]!);
      const fileMatch = href.match(/\/([^/]+\.zip)\/?$/i);
      if (!fileMatch) continue; // pula a própria pasta e não-zips
      const filename = fileMatch[1]!;
      const sizeMatch = block.match(/<d:getcontentlength>(\d+)<\/d:getcontentlength>/i);
      const lmMatch = block.match(/<d:getlastmodified>([^<]+)<\/d:getlastmodified>/i);
      out.push({
        filename,
        url: `${RECEITA_BASE}/${month}/${filename}`,
        size_bytes: sizeMatch ? Number(sizeMatch[1]) : null,
        last_modified: lmMatch ? new Date(lmMatch[1]!).toISOString() : null,
        exists: true,
        http_status: 207,
      });
    }
    return out;
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

      // 3) Lista os arquivos do mês via PROPFIND (1 request → tudo).
      this.log.log(`[receita-dump] listando arquivos de ${month} via WebDAV…`);
      const listed = await this.listMonthFiles(month);
      if (listed.length === 0) {
        await this.markFailed(runId, `Mês ${month} não retornou arquivos (PROPFIND vazio)`);
        return {
          ok: false,
          month,
          manifest_drive_file_id: null,
          manifest_web_view_link: null,
          total_files_available: 0,
          total_size_bytes: 0,
          total_size_mb: 0,
          total_size_gb: 0,
          run_id: runId,
          error: 'no_files_listed',
        };
      }

      // Cross-check: marca quais arquivos esperados (DUMP_FILES) apareceram e
      // anota os que faltaram como exists:false pra cobertura no manifest.
      const listedNames = new Set(listed.map((f) => f.filename));
      const missing: ManifestFile[] = DUMP_FILES.filter((f) => !listedNames.has(f)).map((filename) => ({
        filename,
        url: `${RECEITA_BASE}/${month}/${filename}`,
        size_bytes: null,
        last_modified: null,
        exists: false,
        http_status: 404,
      }));
      const files: ManifestFile[] = [...listed, ...missing];

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
