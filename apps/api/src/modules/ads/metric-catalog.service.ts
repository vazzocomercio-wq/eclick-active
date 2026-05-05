import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';

export type AdPlatformFilter = 'meta' | 'google' | 'shared' | 'all';

export interface AdMetricCatalogEntry {
  key: string;
  platform: 'meta' | 'google' | 'shared';
  display_name: string;
  description: string;
  data_type: 'currency' | 'int' | 'percent' | 'ratio' | 'text';
  direction: 'higher_better' | 'lower_better' | 'neutral';
  aggregation: 'sum' | 'avg' | 'last';
  unit: string;
  category: string;
  is_core: boolean;
}

/**
 * Catálogo curado de métricas (read-only do ponto de vista da app).
 * Cache em memória — o catálogo muda apenas quando uma migration
 * UPDATE roda, e a app reinicia. Cold start refaz.
 */
@Injectable()
export class MetricCatalogService {
  private readonly logger = new Logger(MetricCatalogService.name);
  private cache: AdMetricCatalogEntry[] | null = null;

  constructor(private readonly supabase: SupabaseService) {}

  async loadAll(): Promise<AdMetricCatalogEntry[]> {
    if (this.cache) return this.cache;
    const { data, error } = await this.supabase.adminClient
      .from('ad_metric_catalog')
      .select(
        'key, platform, display_name, description, data_type, direction, aggregation, unit, category, is_core',
      )
      .order('platform', { ascending: true })
      .order('category', { ascending: true })
      .order('display_name', { ascending: true });

    if (error) {
      this.logger.error(`loadAll falhou: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    this.cache = (data ?? []) as AdMetricCatalogEntry[];
    return this.cache;
  }

  async list(platform: AdPlatformFilter = 'all'): Promise<AdMetricCatalogEntry[]> {
    const all = await this.loadAll();
    if (platform === 'all') return all;
    // 'shared' aparece pra qualquer plataforma; 'meta'/'google' específicos
    if (platform === 'shared') return all.filter((m) => m.platform === 'shared');
    return all.filter((m) => m.platform === platform || m.platform === 'shared');
  }

  /** Pega entry por key — usado pelo signal detector + UI. */
  async get(key: string): Promise<AdMetricCatalogEntry | null> {
    const all = await this.loadAll();
    return all.find((m) => m.key === key) ?? null;
  }

  /** Métricas core de uma plataforma — viram defaults pra uma org nova. */
  async listCore(platform: 'meta' | 'google'): Promise<AdMetricCatalogEntry[]> {
    const all = await this.loadAll();
    return all.filter(
      (m) => m.is_core && (m.platform === platform || m.platform === 'shared'),
    );
  }

  /** Limpa cache — útil pra testes / reseed manual sem reiniciar. */
  invalidateCache(): void {
    this.cache = null;
  }
}
