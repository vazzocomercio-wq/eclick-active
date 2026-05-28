import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';

/**
 * Collector — Google Places API (camada 0).
 *
 * Usa Places API New (v1) — endpoint /places:searchText.
 * Doc: https://developers.google.com/maps/documentation/places/web-service/text-search
 *
 * ⚠️ Compliance com ToS do Places:
 *  • CACHE permitido apenas pra Place ID (sem expiração).
 *  • Outros campos: cache até 30 dias, com obrigação de re-verificar
 *    antes de exibir ao usuário (ToS §3.2.3(b)).
 *  • Por simplicidade nesta Fase 0 guardamos o payload completo em
 *    raw_records pra rastreabilidade, mas as entities armazenam só
 *    campos derivados estáveis (nome, endereço, place_id) — telefones
 *    e websites entram em prospect.contacts (que pode ser limpado por
 *    job de TTL se necessário).
 *
 * Custo: free tier do Places dá $200/mês grátis (~5.000 text searches).
 * Tracked em raw_records.cost_cents (estimativa = 3 cents/chamada).
 */

interface PlacesNewLocation {
  latitude: number;
  longitude: number;
}

interface PlacesNewResult {
  id: string;                       // place_id
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  location?: PlacesNewLocation;
  types?: string[];
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;          // OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
}

interface PlacesNewResponse {
  places?: PlacesNewResult[];
  nextPageToken?: string;
}

const SOURCE_ID = 'google_places';
const COST_CENTS_PER_CALL = 3;
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.location',
  'places.types',
  'places.primaryType',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
].join(',');

@Injectable()
export class GooglePlacesCollector {
  private readonly log = new Logger(GooglePlacesCollector.name);

  constructor(private readonly supabase: SupabaseService) {}

  private get db() {
    return this.supabase.adminClient;
  }

  private resolveApiKey(): string {
    const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        'GOOGLE_PLACES_API_KEY não configurada. Setar no Railway antes de usar discover/places.',
      );
    }
    return key;
  }

  /**
   * Busca textual no Places (ex.: "loja de cosméticos em Belo Horizonte MG").
   * Cria entities PJ sem CNPJ (S5 entity_resolver vai casar com Receita depois).
   *
   * @returns IDs das entities criadas/atualizadas + contagem.
   */
  async discoverByText(
    orgId: string,
    params: { query: string; region?: string; maxResults?: number },
  ): Promise<{
    discovered: number;
    created: number;
    updated: number;
    skipped_closed: number;
    entities: Array<{ id: string; display_name: string; place_id: string }>;
  }> {
    const query = params.query?.trim();
    if (!query) throw new BadRequestException('query obrigatório.');
    const maxResults = Math.min(params.maxResults ?? 20, 20); // Places New cap = 20 por página

    const apiKey = this.resolveApiKey();

    // Chama Places New /searchText
    let response: PlacesNewResponse;
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: params.region ? `${query} em ${params.region}` : query,
          maxResultCount: maxResults,
          languageCode: 'pt-BR',
          regionCode: 'BR',
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new BadRequestException(`Places ${res.status}: ${text.slice(0, 200)}`);
      }
      response = (await res.json()) as PlacesNewResponse;
    } catch (e: unknown) {
      if (e instanceof BadRequestException) throw e;
      const msg = (e as { message?: string })?.message ?? 'unknown';
      throw new BadRequestException(`Places fetch falhou: ${msg}`);
    }

    const places = response.places ?? [];
    this.log.log(`[places] query="${query.slice(0, 60)}" → ${places.length} resultados`);

    const result = {
      discovered: places.length,
      created: 0,
      updated: 0,
      skipped_closed: 0,
      entities: [] as Array<{ id: string; display_name: string; place_id: string }>,
    };

    // Custo do request: 1 cobrança independente de quantos resultados (até 20)
    // Grava 1 raw_record agregado por chamada com payload mínimo.
    const { data: rawAgg } = await this.db
      .from('prospect_raw_records')
      .insert({
        org_id: orgId,
        source_id: SOURCE_ID,
        external_ref: query,                  // a query é o "external_ref" agregado
        payload: { query, region: params.region ?? null, count: places.length, sample_ids: places.slice(0, 5).map(p => p.id) },
        cost_cents: COST_CENTS_PER_CALL,
      })
      .select('id')
      .single();
    const rawAggId = (rawAgg as { id: string } | null)?.id ?? null;

    for (const p of places) {
      if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') {
        result.skipped_closed += 1;
        continue;
      }
      const placeId = p.id;
      const displayName = p.displayName?.text ?? null;
      if (!placeId || !displayName) continue;

      // Grava raw_record individual por place (place_id permanente conforme ToS)
      const { data: raw } = await this.db
        .from('prospect_raw_records')
        .insert({
          org_id: orgId,
          source_id: SOURCE_ID,
          external_ref: placeId,
          payload: p as unknown as Record<string, unknown>,
          cost_cents: 0,                      // custo já contado no agregado acima
        })
        .select('id')
        .single();
      const rawId = (raw as { id: string } | null)?.id ?? null;

      // Idempotência: busca entity existente pelo external_ref do place
      // (busca via entity_links → raw_records.external_ref).
      const { data: existingLink } = await this.db
        .from('prospect_entity_links')
        .select('entity_id, prospect_raw_records!inner(external_ref, source_id, org_id)')
        .eq('raw_records.org_id', orgId)
        .eq('raw_records.source_id', SOURCE_ID)
        .eq('raw_records.external_ref', placeId)
        .limit(1)
        .maybeSingle();

      let entityId: string;
      if (existingLink) {
        entityId = (existingLink as { entity_id: string }).entity_id;
        await this.db
          .from('prospect_entities')
          .update({
            display_name: displayName,
            address: this.mapAddress(p),
            geo: p.location ? `(${p.location.longitude},${p.location.latitude})` : null,
          })
          .eq('id', entityId);
        result.updated += 1;
      } else {
        const { data: created, error: insErr } = await this.db
          .from('prospect_entities')
          .insert({
            org_id: orgId,
            entity_type: 'pj',
            display_name: displayName,
            cnae: null,
            address: this.mapAddress(p),
            geo: p.location ? `(${p.location.longitude},${p.location.latitude})` : null,
            status: 'novo',
          })
          .select('id')
          .single();
        if (insErr) {
          this.log.error(`[places] insert entity fail: ${insErr.message}`);
          continue;
        }
        entityId = (created as { id: string }).id;
        result.created += 1;

        // Consent: PJ via dado público Places → legítimo interesse
        await this.db.from('prospect_consent_ledger').insert({
          entity_id: entityId,
          subject_kind: 'pj',
          legal_basis: 'legitimo_interesse',
          origin: SOURCE_ID,
        });
      }

      // entity_link com este raw_record
      if (rawId) {
        await this.db.from('prospect_entity_links').insert({
          entity_id: entityId,
          raw_record_id: rawId,
          match_method: 'probabilistic',     // place_id ≠ CNPJ → não é determinístico
          match_confidence: 80,              // place_id é estável; alta confiança no link
        });
      }

      // Telefone e site viram contacts (separáveis por TTL job futuro)
      const phone = p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null;
      if (phone) {
        await this.upsertContact(entityId, 'phone', phone, 80);
      }
      if (p.websiteUri) {
        await this.upsertContact(entityId, 'site', p.websiteUri, 70);
      }

      // Sinais — guarda rating/visits pro Prospect Score (S6)
      if (p.rating != null && p.userRatingCount != null) {
        await this.db.from('prospect_signals').insert({
          entity_id: entityId,
          signal_type: 'places_reviews',
          value: {
            rating: p.rating,
            count: p.userRatingCount,
            place_id: placeId,
            primary_type: p.primaryType ?? null,
          },
          weight: this.scoreReviewSignal(p.rating, p.userRatingCount),
        });
      }

      result.entities.push({ id: entityId, display_name: displayName, place_id: placeId });
    }

    // Vincula o raw agregado a uma entity dummy? Não — fica como provenance órfão da query.
    if (rawAggId) {
      this.log.log(`[places] raw agregado id=${rawAggId} cost_cents=${COST_CENTS_PER_CALL}`);
    }

    return result;
  }

  private async upsertContact(entityId: string, kind: 'phone' | 'site', value: string, confidence: number) {
    const { data: existing } = await this.db
      .from('prospect_contacts')
      .select('id, validated_in')
      .eq('entity_id', entityId)
      .eq('kind', kind)
      .eq('value', value)
      .maybeSingle();
    if (existing) {
      const cur = existing as { id: string; validated_in: number };
      await this.db
        .from('prospect_contacts')
        .update({
          validated_in: (cur.validated_in ?? 1) + 1,
          last_validated_at: new Date().toISOString(),
        })
        .eq('id', cur.id);
    } else {
      await this.db.from('prospect_contacts').insert({
        entity_id: entityId,
        kind,
        value,
        validated_in: 1,
        confidence,
        is_pii: false, // phone de PJ pública não é PII (mas se for de sócio PF, marcar true)
        last_validated_at: new Date().toISOString(),
      });
    }
  }

  /** Heurística simples: rating alto + muitas avaliações = sinal mais forte. */
  private scoreReviewSignal(rating: number, count: number): number {
    if (rating >= 4.5 && count >= 100) return 90;
    if (rating >= 4.5 && count >= 30) return 75;
    if (rating >= 4.0 && count >= 100) return 70;
    if (rating >= 4.0 && count >= 30) return 60;
    return 40;
  }

  private mapAddress(p: PlacesNewResult): Record<string, unknown> | null {
    if (!p.formattedAddress) return null;
    return {
      formatted: p.formattedAddress,
      place_id: p.id,
      types: p.types ?? [],
      primary_type: p.primaryType ?? null,
    };
  }
}
