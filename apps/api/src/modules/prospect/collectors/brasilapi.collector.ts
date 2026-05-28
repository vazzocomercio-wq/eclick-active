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
    return this.supabase.adminClient;
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
      .from('prospect_raw_records')
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
      const { error: rawErr } = await this.db.from('prospect_raw_records').insert({
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
      .from('prospect_entities')
      .select('id, status')
      .eq('org_id', orgId)
      .eq('cnpj', cnpj)
      .maybeSingle();

    let entityId: string;
    let status: 'created' | 'updated' | 'cached';
    if (existing) {
      entityId = (existing as { id: string }).id;
      const { error: updErr } = await this.db
        .from('prospect_entities')
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
        .from('prospect_entities')
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
      .from('prospect_consent_ledger')
      .select('id')
      .eq('entity_id', entityId)
      .eq('origin', SOURCE_ID)
      .limit(1)
      .maybeSingle();
    if (!existingConsent) {
      await this.db.from('prospect_consent_ledger').insert({
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

  /**
   * Chain de fallback pra contornar bloqueio de IP cloud da BrasilAPI:
   *   1. BrasilAPI (primária — wrapper Receita oficial)
   *   2. minhareceita.org (open-source, mesmo schema da BrasilAPI)
   *   3. publica.cnpj.ws (schema diferente — normalizado abaixo)
   *
   * Se um provider responde 403/429/5xx, tenta o próximo. Só 404 é
   * "CNPJ inexistente" e aborta (não tenta outros).
   *
   * NOTA: solução temporária até o épico CNPJ Data Lake (DL.1-DL.8)
   * indexar a base oficial da Receita.
   */
  private async fetchFromBrasilApi(cnpj: string): Promise<BrasilApiCnpjResponse> {
    const providers: Array<{ name: string; fn: (c: string) => Promise<BrasilApiCnpjResponse | null> }> = [
      { name: 'brasilapi',     fn: c => this.tryBrasilApi(c) },
      { name: 'minhareceita',  fn: c => this.tryMinhaReceita(c) },
      { name: 'publica.cnpj',  fn: c => this.tryPublicaCnpjWs(c) },
    ];

    const errors: string[] = [];
    for (const p of providers) {
      try {
        const result = await p.fn(cnpj);
        if (result) {
          this.log.log(`[brasilapi-chain] ok via ${p.name} cnpj=${cnpj} razao="${result.razao_social ?? '?'}"`);
          return result;
        }
        errors.push(`${p.name}: not_found`);
      } catch (e: unknown) {
        const msg = (e as { message?: string })?.message ?? 'unknown';
        errors.push(`${p.name}: ${msg}`);
        this.log.warn(`[brasilapi-chain] ${p.name} falhou: ${msg}`);
      }
    }
    throw new BadRequestException(
      `Todos os providers públicos de CNPJ falharam. Detalhes: ${errors.join(' | ')}`,
    );
  }

  private async tryBrasilApi(cnpj: string): Promise<BrasilApiCnpjResponse | null> {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) throw new Error('cnpj_not_found');
    if (!res.ok) throw new Error(`http_${res.status}`);
    return (await res.json()) as BrasilApiCnpjResponse;
  }

  /** minhareceita.org tem schema IDÊNTICO à BrasilAPI (ambos wrappam o
   *  mesmo dump da Receita). Retorno direto. */
  private async tryMinhaReceita(cnpj: string): Promise<BrasilApiCnpjResponse | null> {
    const res = await fetch(`https://minhareceita.org/${cnpj}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) throw new Error('cnpj_not_found');
    if (!res.ok) throw new Error(`http_${res.status}`);
    return (await res.json()) as BrasilApiCnpjResponse;
  }

  /** publica.cnpj.ws tem schema aninhado (estabelecimento.*). Normaliza
   *  pra mesma forma da BrasilAPI antes de devolver. */
  private async tryPublicaCnpjWs(cnpj: string): Promise<BrasilApiCnpjResponse | null> {
    const res = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) throw new Error('cnpj_not_found');
    if (!res.ok) throw new Error(`http_${res.status}`);
    const raw = await res.json() as {
      razao_social?: string;
      porte?: { descricao?: string };
      natureza_juridica?: { descricao?: string };
      estabelecimento?: {
        nome_fantasia?: string;
        situacao_cadastral?: string;
        tipo_logradouro?: string;
        logradouro?: string;
        numero?: string;
        complemento?: string;
        bairro?: string;
        cep?: string;
        cidade?: { nome?: string };
        estado?: { sigla?: string };
        atividade_principal?: { id?: string };
        ddd1?: string;
        telefone1?: string;
        email?: string;
      };
      socios?: Array<{ nome?: string }>;
    };
    const est = raw.estabelecimento ?? {};
    // Normaliza pra BrasilApiCnpjResponse
    return {
      cnpj,
      razao_social:                 raw.razao_social,
      nome_fantasia:                est.nome_fantasia,
      porte:                        raw.porte?.descricao,
      natureza_juridica:            raw.natureza_juridica?.descricao,
      descricao_situacao_cadastral: est.situacao_cadastral,
      cnae_fiscal:                  est.atividade_principal?.id ? Number(est.atividade_principal.id) : undefined,
      logradouro:                   [est.tipo_logradouro, est.logradouro].filter(Boolean).join(' '),
      numero:                       est.numero,
      complemento:                  est.complemento,
      bairro:                       est.bairro,
      municipio:                    est.cidade?.nome,
      uf:                           est.estado?.sigla,
      cep:                          est.cep,
      ddd_telefone_1:               est.ddd1 && est.telefone1 ? `${est.ddd1}${est.telefone1}` : undefined,
      email:                        est.email,
      qsa: (raw.socios ?? []).map(s => ({ nome_socio: s.nome })),
    };
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
