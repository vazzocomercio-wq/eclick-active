import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type {
  BulkImportProfilesDto,
  CreateProfileDto,
  ProfileFilters,
  ProfileNetwork,
  TrendProfile,
  UpdateProfileDto,
} from './trends.types';

const PROFILE_NETWORKS: ProfileNetwork[] = ['instagram', 'tiktok', 'youtube', 'x'];

/**
 * Pilar 1 — curadoria de PERFIS de referência (Inteligência Global).
 * CRUD + importação em lote (a "Google Sheets" do método: cola URLs/handles).
 * Tudo escopo por org; adminClient ignora RLS → filtra org_id sempre.
 */
@Injectable()
export class ProfilesService {
  private readonly log = new Logger(ProfilesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string, f: ProfileFilters = {}): Promise<TrendProfile[]> {
    let q = this.supabase.adminClient
      .from('trend_profiles')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });
    if (f.network) q = q.eq('network', f.network);
    if (f.category) q = q.eq('category', f.category);
    if (f.is_active != null) q = q.eq('is_active', f.is_active);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as TrendProfile[];
  }

  /** Perfis ativos p/ mineração (opcionalmente de uma rede). */
  async listActive(orgId: string, network?: ProfileNetwork): Promise<TrendProfile[]> {
    return this.list(orgId, { is_active: true, network });
  }

  async create(orgId: string, dto: CreateProfileDto): Promise<TrendProfile> {
    const parsed = this.resolveHandle(dto.network, dto.handle, dto.url);
    if (!parsed) throw new BadRequestException('handle/url inválido');
    const row = {
      org_id: orgId,
      brand_id: dto.brand_id ?? null,
      network: parsed.network,
      handle: parsed.handle,
      url: parsed.url ?? dto.url ?? null,
      display_name: dto.display_name?.trim() || null,
      country: dto.country?.trim() || null,
      category: dto.category?.trim() || null,
      followers: typeof dto.followers === 'number' ? dto.followers : null,
    };
    const { data, error } = await this.supabase.adminClient
      .from('trend_profiles')
      .upsert(row, { onConflict: 'org_id,network,handle' })
      .select('*')
      .single();
    if (error) throw error;
    return data as TrendProfile;
  }

  /** Importa em lote: cada linha vira um perfil. Ignora duplicados. */
  async bulkImport(
    orgId: string,
    dto: BulkImportProfilesDto,
  ): Promise<{ imported: number; skipped: number }> {
    const lines = (dto.raw ?? '')
      .split(/[\n,;]+/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return { imported: 0, skipped: 0 };

    const seen = new Set<string>();
    const rows: Array<Record<string, unknown>> = [];
    let skipped = 0;
    for (const line of lines) {
      const parsed = this.resolveHandle(dto.network, line, line);
      if (!parsed) {
        skipped += 1;
        continue;
      }
      const key = `${parsed.network}|${parsed.handle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        org_id: orgId,
        brand_id: dto.brand_id ?? null,
        network: parsed.network,
        handle: parsed.handle,
        url: parsed.url ?? null,
        category: dto.category?.trim() || null,
        country: dto.country?.trim() || null,
      });
    }
    if (!rows.length) return { imported: 0, skipped };

    const { data, error } = await this.supabase.adminClient
      .from('trend_profiles')
      .upsert(rows, { onConflict: 'org_id,network,handle', ignoreDuplicates: true })
      .select('id');
    if (error) throw error;
    return { imported: (data ?? []).length, skipped };
  }

  async update(orgId: string, id: string, dto: UpdateProfileDto): Promise<TrendProfile> {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.display_name != null) patch.display_name = dto.display_name.trim() || null;
    if (dto.country != null) patch.country = dto.country.trim() || null;
    if (dto.category != null) patch.category = dto.category.trim() || null;
    if (dto.followers != null) patch.followers = dto.followers;
    if (dto.is_active != null) patch.is_active = dto.is_active;
    if (dto.notes != null) patch.notes = dto.notes.slice(0, 500) || null;

    const { data, error } = await this.supabase.adminClient
      .from('trend_profiles')
      .update(patch)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Perfil não encontrado');
    return data as TrendProfile;
  }

  async remove(orgId: string, id: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('trend_profiles')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);
    if (error) throw error;
  }

  async markCollected(orgId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.supabase.adminClient
      .from('trend_profiles')
      .update({ last_collected_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .in('id', ids);
  }

  /**
   * Resolve {network, handle, url} a partir de uma URL ou "@handle".
   * Infere a rede pela URL; cai no `fallback` quando não dá pra inferir.
   */
  resolveHandle(
    fallback: ProfileNetwork | undefined,
    handle?: string,
    url?: string,
  ): { network: ProfileNetwork; handle: string; url: string | null } | null {
    const raw = (url || handle || '').trim();
    if (!raw) return null;

    // URL completa
    const m = raw.match(/^https?:\/\/([^/]+)\/(.+?)\/?(?:\?.*)?$/i);
    if (m) {
      const host = m[1].toLowerCase();
      const path = m[2];
      if (host.includes('instagram.com')) {
        const h = path.split('/')[0].replace(/^@/, '');
        if (h) return { network: 'instagram', handle: h.toLowerCase(), url: `https://www.instagram.com/${h}/` };
      }
      if (host.includes('tiktok.com')) {
        const seg = path.split('/').find((p) => p.startsWith('@')) ?? path.split('/')[0];
        const h = seg.replace(/^@/, '');
        if (h) return { network: 'tiktok', handle: h.toLowerCase(), url: `https://www.tiktok.com/@${h}` };
      }
      if (host.includes('youtube.com')) {
        const h = path.replace(/^(c|channel|user)\//, '').split('/')[0].replace(/^@/, '');
        if (h) return { network: 'youtube', handle: h.toLowerCase(), url: raw };
      }
      if (host.includes('twitter.com') || host.includes('x.com')) {
        const h = path.split('/')[0].replace(/^@/, '');
        if (h) return { network: 'x', handle: h.toLowerCase(), url: `https://x.com/${h}` };
      }
      return null; // URL de host desconhecido
    }

    // "@handle" ou handle puro → precisa do fallback de rede
    const net = fallback && PROFILE_NETWORKS.includes(fallback) ? fallback : null;
    if (!net) return null;
    const h = raw.replace(/^@/, '').replace(/\s+/g, '').toLowerCase();
    if (!h || /[^a-z0-9._-]/.test(h)) return null;
    const built =
      net === 'instagram'
        ? `https://www.instagram.com/${h}/`
        : net === 'tiktok'
          ? `https://www.tiktok.com/@${h}`
          : net === 'x'
            ? `https://x.com/${h}`
            : null;
    return { network: net, handle: h, url: built };
  }
}
