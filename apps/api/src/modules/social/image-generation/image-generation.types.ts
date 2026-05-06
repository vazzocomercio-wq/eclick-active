/**
 * Tipos compartilhados pelos providers de geração de imagem.
 */

export interface GenerateImageInput {
  /** Prompt textual descrevendo a imagem. */
  prompt: string;
  /** Hook/título pra colocar como overlay no placeholder SVG. */
  overlayText?: string;
  /** Cor primária da marca (hex). */
  primaryColor: string;
  /** Cor secundária da marca (hex). */
  secondaryColor: string;
  /** Largura desejada (default 1080). */
  width?: number;
  /** Altura desejada (default 1080). */
  height?: number;
  /** Brand kit ID do Canva (se aplicável). */
  canvaBrandKitId?: string | null;
}

export interface GeneratedImage {
  /** Buffer com bytes da imagem (PNG/JPG/SVG). */
  buffer: Buffer;
  /** MIME type real do buffer. */
  mimeType: string;
  /** Provider que gerou. */
  provider: 'canva' | 'openai' | 'placeholder';
  /** Largura final. */
  width: number;
  /** Altura final. */
  height: number;
  /** Extensão sugerida (.png, .jpg, .svg). */
  ext: string;
}

export interface ImageProvider {
  readonly name: 'canva' | 'openai' | 'placeholder';
  /** True se o provider está configurado e pode gerar. */
  isAvailable(orgId: string): Promise<boolean>;
  generate(orgId: string, input: GenerateImageInput): Promise<GeneratedImage>;
}
