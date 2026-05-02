import { IsArray, IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { KnowledgeCategory } from '@eclick-active/shared';

const CATEGORIES: KnowledgeCategory[] = [
  'products',
  'pricing',
  'policies',
  'faq',
  'scripts',
  'objections',
  'procedures',
  'general',
];

/**
 * DTO da segunda etapa do upload: o admin já viu o preview e confirmou.
 * O texto extraído vem no body porque é mais simples que persistir um
 * "draft" de upload no banco.
 */
export class ConfirmFileUploadDto {
  @IsString()
  @Length(1, 200)
  filename!: string;

  @IsString()
  @Length(1, 100_000)
  content!: string;

  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: KnowledgeCategory;

  @IsOptional()
  @IsString()
  @IsIn(['pdf', 'excel', 'csv', 'word', 'text'])
  file_type?: 'pdf' | 'excel' | 'csv' | 'word' | 'text';

  /**
   * Quando o admin escolhe importar sheets específicas de um Excel — cada
   * item gera um documento separado (com sheet_name no metadata). Quando
   * vazio/ausente, salva tudo como 1 doc só.
   */
  @IsOptional()
  @IsArray()
  selected_sheets?: Array<{ name: string; content: string; rows?: number }>;

  /**
   * Tamanho original do arquivo em bytes — guardado em metadata pra UI
   * exibir e pra rastreio. Opcional (cliente pode não saber em alguns
   * casos exotéricos, mas idealmente sempre vem).
   */
  @IsOptional()
  file_size?: number;

  @IsOptional()
  pages_count?: number;
}
