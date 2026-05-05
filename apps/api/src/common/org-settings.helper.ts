import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Default timezone usado quando org não configurou um. Brasil-first.
 */
export const DEFAULT_ORG_TZ = 'America/Sao_Paulo';

/**
 * Cache em memória pra evitar query a cada formatação. Invalida em 5min.
 * Fonte de verdade fica em organizations.settings.timezone.
 */
const tzCache = new Map<string, { tz: string; until: number }>();

/**
 * Resolve o timezone de uma org via organizations.settings.timezone.
 * Fallback pro default. Best-effort: erros voltam pro default.
 */
export async function getOrgTimezone(
  client: SupabaseClient,
  orgId: string,
): Promise<string> {
  const cached = tzCache.get(orgId);
  if (cached && cached.until > Date.now()) return cached.tz;

  try {
    const { data } = await client
      .from('organizations')
      .select('settings')
      .eq('id', orgId)
      .maybeSingle();
    const settings = (data?.settings as Record<string, unknown> | null) ?? {};
    const raw = settings.timezone;
    const tz = typeof raw === 'string' && raw.length > 0 ? raw : DEFAULT_ORG_TZ;
    tzCache.set(orgId, { tz, until: Date.now() + 5 * 60 * 1000 });
    return tz;
  } catch {
    return DEFAULT_ORG_TZ;
  }
}

/** Limpa o cache pra uma org (chamar quando settings.timezone mudar). */
export function invalidateOrgTimezoneCache(orgId: string): void {
  tzCache.delete(orgId);
}
