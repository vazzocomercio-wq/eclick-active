import { BadRequestException, Injectable, Logger } from '@nestjs/common';

/**
 * Resultado da extração de texto de um arquivo upload.
 */
export interface ExtractedFile {
  filename: string;
  file_type: 'pdf' | 'excel' | 'csv' | 'word' | 'text';
  file_size: number;
  content: string;
  char_count: number;
  token_estimate: number;
  truncated: boolean;
  pages_count?: number;
  /**
   * Para Excel — lista de sheets com nome + content separado. O admin
   * escolhe quais salvar. Quando presente, `content` contém todas
   * concatenadas como fallback se o admin não dividir.
   */
  sheets?: Array<{ name: string; content: string; rows: number }>;
}

const MAX_CHARS = 100_000;

/**
 * Extrai texto de arquivos PDF, Excel, CSV, Word, TXT/MD.
 */
@Injectable()
export class FileExtractorService {
  private readonly logger = new Logger(FileExtractorService.name);

  async extract(args: {
    filename: string;
    mimetype: string;
    buffer: Buffer;
  }): Promise<ExtractedFile> {
    const { filename, mimetype, buffer } = args;
    const ext = this.getExtension(filename);

    if (ext === 'pdf' || mimetype === 'application/pdf') {
      return this.extractPdf(filename, buffer);
    }
    if (ext === 'xlsx' || ext === 'xls' || mimetype.includes('spreadsheet') || mimetype.includes('excel')) {
      return this.extractExcel(filename, buffer, 'excel');
    }
    if (ext === 'csv' || mimetype === 'text/csv') {
      return this.extractExcel(filename, buffer, 'csv');
    }
    if (ext === 'docx' || mimetype.includes('wordprocessingml') || mimetype === 'application/msword') {
      return this.extractWord(filename, buffer);
    }
    if (ext === 'txt' || ext === 'md' || mimetype.startsWith('text/')) {
      return this.extractPlainText(filename, buffer);
    }

    throw new BadRequestException(
      `Tipo de arquivo não suportado: ${mimetype || ext}. Aceitos: PDF, Excel (xlsx/xls/csv), Word (docx), TXT, MD.`,
    );
  }

  // ────────────────────────────────────────────
  // PDF
  // ────────────────────────────────────────────

  private async extractPdf(filename: string, buffer: Buffer): Promise<ExtractedFile> {
    let pdfParse: (buf: Buffer) => Promise<{ text: string; numpages: number }>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      pdfParse = require('pdf-parse');
    } catch (err) {
      this.logger.error(`pdf-parse load failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('Biblioteca de PDF indisponível no servidor.');
    }

    let parsed: { text: string; numpages: number };
    try {
      parsed = await pdfParse(buffer);
    } catch (err) {
      throw new BadRequestException(
        `Falha ao ler PDF: ${err instanceof Error ? err.message : 'arquivo corrompido?'}`,
      );
    }

    const cleaned = this.normalize(parsed.text);
    const truncated = cleaned.length > MAX_CHARS;
    const content = truncated ? cleaned.slice(0, MAX_CHARS) + '\n\n[…conteúdo truncado em 100.000 caracteres]' : cleaned;

    if (!content.trim()) {
      throw new BadRequestException(
        'PDF não contém texto extraível. É um PDF escaneado/imagem? Use OCR antes de subir.',
      );
    }

    return {
      filename,
      file_type: 'pdf',
      file_size: buffer.length,
      content,
      char_count: content.length,
      token_estimate: Math.ceil(content.length / 4),
      truncated,
      pages_count: parsed.numpages,
    };
  }

  // ────────────────────────────────────────────
  // Excel / CSV
  // ────────────────────────────────────────────

  private async extractExcel(
    filename: string,
    buffer: Buffer,
    kind: 'excel' | 'csv',
  ): Promise<ExtractedFile> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require('xlsx') as typeof import('xlsx');
    let workbook: import('xlsx').WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch (err) {
      throw new BadRequestException(
        `Falha ao ler planilha: ${err instanceof Error ? err.message : 'arquivo inválido'}`,
      );
    }

    const sheets: Array<{ name: string; content: string; rows: number }> = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
        defval: '',
        raw: false,
      });
      if (rows.length === 0) continue;

      const headers = Object.keys(rows[0] ?? {});
      const lines: string[] = [];
      lines.push(`# Sheet: ${sheetName}`);
      lines.push(`Colunas: ${headers.join(' | ')}`);
      lines.push('');
      for (const [i, row] of rows.entries()) {
        const parts: string[] = [];
        for (const h of headers) {
          const v = String(row[h] ?? '').trim();
          if (v) parts.push(`${h}: ${v}`);
        }
        if (parts.length > 0) lines.push(`${i + 1}. ${parts.join(' · ')}`);
      }
      sheets.push({
        name: sheetName,
        content: this.normalize(lines.join('\n')),
        rows: rows.length,
      });
    }

    if (sheets.length === 0) {
      throw new BadRequestException('Planilha vazia ou sem dados estruturados.');
    }

    const combined = sheets.map((s) => s.content).join('\n\n---\n\n');
    const truncated = combined.length > MAX_CHARS;
    const content = truncated
      ? combined.slice(0, MAX_CHARS) + '\n\n[…conteúdo truncado em 100.000 caracteres]'
      : combined;

    return {
      filename,
      file_type: kind,
      file_size: buffer.length,
      content,
      char_count: content.length,
      token_estimate: Math.ceil(content.length / 4),
      truncated,
      sheets,
    };
  }

  // ────────────────────────────────────────────
  // Word (.docx)
  // ────────────────────────────────────────────

  private async extractWord(filename: string, buffer: Buffer): Promise<ExtractedFile> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = require('mammoth') as typeof import('mammoth');
    let result: { value: string };
    try {
      result = await mammoth.extractRawText({ buffer });
    } catch (err) {
      throw new BadRequestException(
        `Falha ao ler Word: ${err instanceof Error ? err.message : 'arquivo inválido'}`,
      );
    }

    const cleaned = this.normalize(result.value);
    const truncated = cleaned.length > MAX_CHARS;
    const content = truncated
      ? cleaned.slice(0, MAX_CHARS) + '\n\n[…conteúdo truncado em 100.000 caracteres]'
      : cleaned;

    if (!content.trim()) {
      throw new BadRequestException('Documento Word sem conteúdo textual.');
    }

    return {
      filename,
      file_type: 'word',
      file_size: buffer.length,
      content,
      char_count: content.length,
      token_estimate: Math.ceil(content.length / 4),
      truncated,
    };
  }

  // ────────────────────────────────────────────
  // TXT / MD
  // ────────────────────────────────────────────

  private extractPlainText(filename: string, buffer: Buffer): ExtractedFile {
    let raw: string;
    try {
      raw = buffer.toString('utf-8');
    } catch {
      raw = buffer.toString('latin1');
    }

    const cleaned = this.normalize(raw);
    const truncated = cleaned.length > MAX_CHARS;
    const content = truncated
      ? cleaned.slice(0, MAX_CHARS) + '\n\n[…conteúdo truncado em 100.000 caracteres]'
      : cleaned;

    if (!content.trim()) {
      throw new BadRequestException('Arquivo de texto vazio.');
    }

    return {
      filename,
      file_type: 'text',
      file_size: buffer.length,
      content,
      char_count: content.length,
      token_estimate: Math.ceil(content.length / 4),
      truncated,
    };
  }

  // ────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────

  /** Normaliza espaços, remove caracteres de controle, limita newlines. */
  private normalize(s: string): string {
    return s
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private getExtension(filename: string): string {
    const idx = filename.lastIndexOf('.');
    return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : '';
  }

  /**
   * Divide um content grande em chunks de ~4000 tokens com overlap de 200.
   * Quebra em parágrafos sempre que possível.
   */
  chunkContent(content: string, chunkSize = 4000, overlap = 200): string[] {
    const chunkChars = chunkSize * 4;
    const overlapChars = overlap * 4;
    if (content.length <= chunkChars) return [content];

    const chunks: string[] = [];
    let pos = 0;
    while (pos < content.length) {
      let end = Math.min(pos + chunkChars, content.length);
      if (end < content.length) {
        const breakAt = content.lastIndexOf('\n\n', end);
        if (breakAt > pos + chunkChars / 2) end = breakAt;
      }
      chunks.push(content.slice(pos, end).trim());
      if (end >= content.length) break;
      pos = Math.max(0, end - overlapChars);
    }
    return chunks.filter((c) => c.length > 0);
  }
}
