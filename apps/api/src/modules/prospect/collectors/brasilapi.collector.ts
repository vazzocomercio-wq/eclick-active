import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';

/**
 * Collector — Receita Federal via BrasilAPI (camada 0, grátis).
 *
 * BrasilAPI = wrapper público sobre o dump da Receita Federal.
 * Rate limit: ~1 req/sec no free tier (sem autenticação).
 *
 * Doc: https://brasilapi.com.br/docs#tag/CNPJ
 *
 * Estratégia:
 *  1) Idempotência: se já existe raw_record dessa fonte+cnpj < 30 dias,
 *     pula a chamada (cache).
 *  2) Grava payload bruto em prospect.raw_records (provenance).
 *  3) Cria/atualiza entity correspondente (deterministic match por CNPJ).
 *  4) Vincula raw → entity em entity_links (match_method=deterministic_cnpj).
 *  5) Custo = 0 cents (grátis).
 */

interface BrasilApiCnpjResponse {
  cnpj: string;
  razao_social?: string;
  nome_fantasia?: string;
  cnae_fiscal?: number;
  cnae_fiscal_descricao?: string;
  porte?: string;
  natureza_juridica?: string;
  situacao_cadastral?: number;        // 2=Ativa, 8=Baixada, etc.
  descricao_situacao_cadastral?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  ddd_telefone_1?: string;
  ddd_telefone_2?: string;
  email?: string;
  qsa?: Array<{
    nome_socio?: string;
    cnpj_cpf_do_socio?: string;
    qualificacao_socio?: string;
    data_entrada_sociedade?: string;
  }>;
  [k: string]: unknown;
}

const onlyDigits = (s: string) => s.replace(/\D+/g, '');
const CACHE_TTL_DAYS = 30;
const SOURCE_ID = 'brasilapi_cnpj';

@Injectable()
export class BrasilApiCollector {
  private readonly log = new Logger(BrasilApiCollector.name);

  constructor(private readonly supabase: SupabaseService) {}

  private get db() {
    return this.supabase.adminClient.schema('prospect' as 'public');
  }

  /**
   * Coleta CNPJ via BrasilAPI. Cria/atualiza entidade. Retorna o id.
   *
   * @throws BadRequestException CNPJ inválido / inativo / BrasilAPI down.
   */
  async collect(orgId: string, cnpjInput: string): Promise<{
    entity_id: string;
    status: 'created' | 'updated' | 'cached';
    razao_social: string | null;
    situacao: string | null;
  }> {
    const cnpj = onlyDigits(cnpjInput);
    if (cnpj.length !== 14) throw new BadRequestException('CNPJ deve ter 14 dígitos.');

    // 1) Idempotência — checa cache
    const since = new Date(Date.now() - CACHE_TTL_DAYS * 86400_000).toISOString();
    const { data: cached } = await this.db
      .from('raw_records')
      .select('id, payload, collected_at')
      .eq('org_id', orgId)
      .eq('source_id', SOURCE_ID)
      .eq('external_ref', cnpj)
      .gte('collected_at', since)
      .order('collected_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let payload: BrasilApiCnpjResponse | null = null;
    let usedCache = false;

    if (cached) {
      payload = (cached as { payload: BrasilApiCnpjResponse }).payload;
      usedCache = true;
      this.log.log(`[brasilapi] cache hit cnpj=${cnpj}`);
    } else {
      // 2) Chama BrasilAPI
      payload = await this.fetchFromBrasilApi(cnpj);
    }

    // 3) Persistência: raw_record (se não foi do cache) + entity
    if (!usedCache && payload) {
      const { error: rawErr } = await this.db.from('raw_records').insert({
        org_id: orgId,
        source_id: SOURCE_ID,
        external_ref: cnpj,
        payload: payload as unknown as Record<string, unknown>,
        cost_cents: 0,
      });
      if (rawErr) this.log.error(`[brasilapi] raw insert fail: ${rawErr.message}`);
    }

    if (!payload) {
      throw new BadRequestException('BrasilAPI retornou payload vazio.');
    }

    const entityData = this.mapToEntity(payload);

    // 4) Upsert da entity (idempotente por org_id+cnpj)
    const { data: existing } = await this.db
      .from('entities')
      .select('id, status')
      .eq('org_id', orgId)
      .eq('cnpj', cnpj)
      .maybeSingle();

    let entityId: string;
    let status: 'created' | 'updated' | 'cached';
    if (existing) {
      entityId = (existing as { id: string }).id;
      const { error: updErr } = await this.db
        .from('entities')
        .update({
          ...entityData,
          status:
            (existing as { status: string }).status === 'novo'
              ? 'enriquecido'
              : (existing as { status: string }).status,
        })
        .eq('id', entityId);
      if (updErr) throw new BadRequestException(updErr.message);
      status = usedCache ? 'cached' : 'updated';
    } else {
      const { data: created, error: insErr } = await this.db
        .from('entities')
        .insert({
          org_id: orgId,
          entity_type: 'pj',
          cnpj,
          ...entityData,
          status: 'enriquecido',
        })
        .select('id')
        .single();
      if (insErr) throw new BadRequestException(insErr.message);
      entityId = (created as { id: string }).id;
      status = 'created';
    }

    // 5) Consent ledger — legítimo interesse PJ (dado público Receita)
    //    Só insere uma vez por entity+origin pra não duplicar.
    const { data: existingConsent } = await this.db
      .from('consent_ledger')
      .select('id')
      .eq('entity_id', entityId)
      .eq('origin', SOURCE_ID)
      .limit(1)
      .maybeSingle();
    if (!existingConsent) {
      await this.db.from('consent_ledger').insert({
        entity_id: entityId,
        subject_kind: 'pj',
        legal_basis: 'legitimo_interesse',
        origin: SOURCE_ID,
      });
    }

    return {
      entity_id: entityId,
      status,
      razao_social: entityData.razao_social,
      situacao: entityData.situacao,
    };
  }

  /** Bate na BrasilAPI. Trata 404 (CNPJ inexistente) com erro amigável. */
  private async fetchFromBrasilApi(cnpj: string): Promise<BrasilApiCnpjResponse> {
    const url = `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`;
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        // BrasilAPI free tier: ~1 req/s. Timeout de 15s pra dump completo.
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) {
        throw new BadRequestException('CNPJ não encontrado na Receita.');
      }
      if (res.status === 429) {
        throw new BadRequestException('BrasilAPI rate-limit atingido. Tente novamente em 1min.');
      }
      if (!res.ok) {
        throw new BadRequestException(`BrasilAPI erro ${res.status}.`);
      }
      const json = (await res.json()) as BrasilApiCnpjResponse;
      this.log.log(`[brasilapi] fetch ok cnpj=${cnpj} razao="${json.razao_social ?? '?'}"`);
      return json;
    } catch (e: unknown) {
      if (e instanceof BadRequestException) throw e;
      const msg = (e as { message?: string })?.message ?? 'unknown';
      throw new BadRequestException(`BrasilAPI fetch falhou: ${msg}`);
    }
  }

  /** Mapeia resposta BrasilAPI → colunas de prospect.entities. */
  private mapToEntity(p: BrasilApiCnpjResponse) {
    return {
      razao_social: p.razao_social ?? null,
      nome_fantasia: p.nome_fantasia ?? null,
      display_name: p.nome_fantasia || p.razao_social || null,
      cnae: p.cnae_fiscal != null ? String(p.cnae_fiscal) : null,
      porte: p.porte ?? null,
      natureza: p.natureza_juridica ?? null,
      situacao: p.descricao_situacao_cadastral ?? null,
      address: this.mapAddress(p),
    };
  }

  private mapAddress(p: BrasilApiCnpjResponse): Record<string, unknown> | null {
    if (!p.logradouro && !p.municipio && !p.uf) return null;
    return {
      logradouro: p.logradouro ?? null,
      numero: p.numero ?? null,
      complemento: p.complemento ?? null,
      bairro: p.bairro ?? null,
      cidade: p.municipio ?? null,
      uf: p.uf ?? null,
      cep: p.cep ?? null,
    };
  }
}
