import { Injectable, Logger } from '@nestjs/common';
import { TrendsService } from './trends.service';
import { ProfilesService } from './profiles.service';
import { InstagramProfileConnector } from './connectors/instagram-profile.connector';
import { TikTokProfileConnector } from './connectors/tiktok-profile.connector';
import type {
  NewTrendItem,
  ProfileMiningConnector,
  ProfileMiningOptions,
  ProfileNetwork,
  TrendProfile,
} from './trends.types';

export interface MineResult {
  profiles: number;
  items: number;
  by_network: Record<string, number>;
}

/**
 * Pilar 1 — orquestra a mineração POR PERFIL.
 * Registry platform-agnostic: cada rede aponta pra um conector. Adicionar X =
 * 1 conector + 1 linha aqui. O motor (seleção/upsert/throttle) não muda.
 *
 * Throttle de custo (Apify) reusa a mesma janela do collector de hashtags.
 */
@Injectable()
export class ProfileMiningService {
  private readonly log = new Logger(ProfileMiningService.name);
  private readonly registry: Map<ProfileNetwork, ProfileMiningConnector>;

  constructor(
    private readonly trends: TrendsService,
    private readonly profiles: ProfilesService,
    instagram: InstagramProfileConnector,
    tiktok: TikTokProfileConnector,
  ) {
    this.registry = new Map<ProfileNetwork, ProfileMiningConnector>([
      [instagram.network, instagram],
      [tiktok.network, tiktok],
    ]);
  }

  private opts(): ProfileMiningOptions {
    return {
      newerThanDays: Number(process.env.PROFILE_MINING_NEWER_THAN_DAYS ?? 7),
      resultsPerProfile: Number(process.env.PROFILE_MINING_RESULTS_PER_PROFILE ?? 10),
    };
  }

  /**
   * Minera todos os perfis ativos da org. `force` ignora a trava de frequência
   * (usado pelo botão manual). by_network conta itens upsertados.
   */
  async mineAll(orgId: string, force = false): Promise<MineResult> {
    const everyDays = Number(process.env.TIKTOK_COLLECT_EVERY_DAYS ?? 7);
    const now = Date.now();
    const all = await this.profiles.listActive(orgId);

    // agrupa por rede; aplica throttle por perfil
    const byNet = new Map<ProfileNetwork, TrendProfile[]>();
    for (const p of all) {
      if (!this.registry.has(p.network)) continue;
      if (!force && p.last_collected_at) {
        const ageDays = (now - new Date(p.last_collected_at).getTime()) / 86400000;
        if (ageDays < everyDays) continue;
      }
      const arr = byNet.get(p.network);
      if (arr) arr.push(p);
      else byNet.set(p.network, [p]);
    }

    const opts = this.opts();
    const by_network: Record<string, number> = {};
    let items = 0;
    let minedProfiles = 0;
    const collectedIds: string[] = [];

    for (const [network, profiles] of byNet) {
      const connector = this.registry.get(network);
      if (!connector || !connector.isConfigured()) continue;
      try {
        const collected: NewTrendItem[] = await connector.collectProfiles(profiles, opts);
        const n = await this.trends.upsertItems(orgId, collected);
        by_network[network] = (by_network[network] ?? 0) + n;
        items += n;
        minedProfiles += profiles.length;
        collectedIds.push(...profiles.map((p) => p.id));
        this.log.log(`mineração ${network}: ${profiles.length} perfis → ${n} itens`);
      } catch (err) {
        this.log.warn(`mineração ${network} falhou: ${(err as Error).message}`);
      }
    }

    await this.profiles.markCollected(orgId, collectedIds);
    return { profiles: minedProfiles, items, by_network };
  }
}
