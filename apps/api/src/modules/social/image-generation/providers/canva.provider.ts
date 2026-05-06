import { Injectable, Logger } from '@nestjs/common';
import type {
  GeneratedImage,
  GenerateImageInput,
  ImageProvider,
} from '../image-generation.types';

/**
 * Provider Canva — STUB pra integração futura.
 *
 * Active não tem módulo Canva ainda (existe no SaaS — eclick-backend).
 * Estrutura está pronta pra quando integrar:
 *   1. Adicionar canva.service.ts importando o SDK ou batendo na API
 *   2. Implementar isAvailable() lendo cred OAuth do org
 *   3. Implementar generate() chamando Canva API com brand_kit_id
 *
 * Por enquanto retorna sempre unavailable → ImageGenerationService cai
 * no OpenAIProvider e depois PlaceholderProvider.
 */
@Injectable()
export class CanvaImageProvider implements ImageProvider {
  private readonly log = new Logger(CanvaImageProvider.name);
  readonly name = 'canva' as const;

  async isAvailable(_orgId: string): Promise<boolean> {
    // TODO: ler `org_canva_credentials` quando módulo Canva existir
    return false;
  }

  async generate(_orgId: string, _input: GenerateImageInput): Promise<GeneratedImage> {
    throw new Error('Provider Canva ainda não implementado no Active');
  }
}
