import { Injectable, Logger } from '@nestjs/common';
import { MetaProvider } from './providers/meta.provider';
import { GoogleProvider } from './providers/google.provider';
import type { AdProvider, Platform } from './contracts/ad-provider';

/**
 * Resolve `platform → provider`. Mesmo papel do ChannelDispatcher do Active.
 *
 * Registrar uma plataforma nova = injetar o provider no construtor e chamar
 * `register()`. O motor nunca toca aqui — só pede `resolve(platform)`.
 */
@Injectable()
export class AdProviderDispatcher {
  private readonly logger = new Logger(AdProviderDispatcher.name);
  private readonly providers = new Map<Platform, AdProvider>();

  constructor(meta: MetaProvider, google: GoogleProvider) {
    this.register(meta);
    this.register(google);
    // Futuro: this.register(tiktok), this.register(mercadoLivre), ...
  }

  private register(provider: AdProvider): void {
    this.providers.set(provider.platform, provider);
    this.logger.log(`Provider registrado: ${provider.platform}`);
  }

  resolve(platform: Platform): AdProvider {
    const provider = this.providers.get(platform);
    if (!provider) {
      throw new Error(
        `Nenhum AdProvider registrado pra plataforma "${platform}". Suportadas: ${this.supported().join(', ')}`,
      );
    }
    return provider;
  }

  isSupported(platform: Platform): boolean {
    return this.providers.has(platform);
  }

  supported(): Platform[] {
    return Array.from(this.providers.keys());
  }
}
