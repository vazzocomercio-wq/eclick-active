import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { BrasilApiCollector } from './collectors/brasilapi.collector';
import { GooglePlacesCollector } from './collectors/google-places.collector';
import { SaasBridgeCollector } from './collectors/saas-bridge.collector';
import { EntityResolverService } from './entity-resolver.service';
import { ProspectScorerService } from './prospect-scorer.service';
import type {
  CacReport,
  CollectDto,
  DiscoverPlacesDto,
  EnrichDto,
  ListEntitiesQuery,
  OptOutPublicDto,
  ProspectEntityRow,
  PromoteDto,
  ResolveMatchDto,
} from './prospect.types';

const onlyDigits = (s: string | undefined | null) =>
  (s ?? '').replace(/\D+/g, '');

/**
 * Motor do e-Click Prospect — Lead Intelligence Engine.
 *
 * Esta classe é o stub da S2: define os contratos públicos que o controller
 * chama e devolve placeholders consistentes. A lógica real vem nas sprints
 * S3 (collectors) → S6 (Prospect Score) → S7 (bridge → Active).
 *
 * Acessa o schema `prospect.*` via `client.schema('prospect')` — service_role
 * bypassa RLS, então toda chamada precisa filtrar `org_id` explicitamente.
 */
@Injectable()
export class ProspectService {
  private readonly log = new Logger(ProspectService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly brasilApi: BrasilApiCollector,
    private readonly places: GooglePlacesCollector,
    private readonly saasBridge: SaasBridgeCollector,
    private readonly resolver: EntityResolverService,
    private readonly scorer: ProspectScorerService,
  ) {}

  /** Recalcula prospect_score de uma entity. */
  async scoreEntity(orgId: string, entityId: string) {
    return this.scorer.scoreEntity(orgId, entityId);
  }

  /** Recalcula score de todas as entities da org (opcional: filtra por status). */
  async rescoreOrg(orgId: string, status?: string[]) {
    return this.scorer.rescoreOrg(orgId, status ? { onlyStatus: status } : undefined);
  }

  // ──────────────────────────────────────────────────────────────────
  // Discovery — Google Places (S4)
  // ──────────────────────────────────────────────────────────────────
  async discoverPlaces(orgId: string, dto: DiscoverPlacesDto) {
    const result = await this.places.discoverByText(orgId, {
      query: dto.query,
      region: dto.region,
      maxResults: dto.max_results,
    });
    // S5 + S6: dispara resolver + score pra cada entity (async, não bloqueia).
    for (const ent of result.entities) {
      this.resolver
        .resolve(orgId, ent.id)
        .then(() => this.scorer.scoreEntity(orgId, ent.id))
        .catch(err =>
          this.log.error(`[post-discover async] entity=${ent.id}: ${(err as Error).message}`),
        );
    }
    return result;
  }

  /** Endpoint manual: força re-resolução de uma entity (gera embedding + match). */
  async resolveEntity(orgId: string, entityId: string) {
    return this.resolver.resolve(orgId, entityId);
  }

  /** Cliente Supabase. Tabelas do Prospect vivem em `active.prospect_*`
   *  (movidas em 088 — PostgREST não expõe schema `prospect`). */
  private get db() {
    return this.supabase.adminClient;
  }

  /** Alias retrocompat — antes apontava pra `active.*` (schema padrão).
   *  Continua valendo a mesma coisa agora. */
  private get activeDb() {
    return this.supabase.adminClient;
  }

  // ──────────────────────────────────────────────────────────────────
  // Collect — disparar coleta (S3/S4 implementam de verdade)
  // ──────────────────────────────────────────────────────────────────
  async collect(orgId: string, dto: CollectDto): Promise<{
    entity_id: string;
    status: 'created' | 'updated' | 'cached';
    source_used: string;
  }> {
    // ── Branch PF (decisão 2026-05-28: liberada por org via flag) ──────
    if (dto.entity_type === 'pf') {
      return this.collectPf(orgId, dto);
    }

    // ── Branch PJ ──────────────────────────────────────────────────────
    const cnpj = onlyDigits(dto.cnpj);
    if (!cnpj || cnpj.length !== 14) {
      throw new BadRequestException('CNPJ inválido (14 dígitos).');
    }

    // Routing por source_id. Default = brasilapi_cnpj (camada 0 grátis).
    const sourceId = dto.source_id ?? 'brasilapi_cnpj';

    if (sourceId === 'brasilapi_cnpj' || sourceId === 'receita_aberta') {
      const result = await this.brasilApi.collect(orgId, cnpj);
      // S5 + S6: dispara resolver + score async (não bloqueia resposta)
      this.resolver
        .resolve(orgId, result.entity_id)
        .then(() => this.scorer.scoreEntity(orgId, result.entity_id))
        .catch(err =>
          this.log.error(`[post-collect async] entity=${result.entity_id}: ${(err as Error).message}`),
        );
      return {
        entity_id: result.entity_id,
        status: result.status,
        source_used: 'brasilapi_cnpj',
      };
    }

    // Outras fontes PJ entram nas próximas sprints (bridge SaaS).
    throw new BadRequestException(
      `Fonte PJ '${sourceId}' ainda não implementada. Disponível: brasilapi_cnpj.`,
    );
  }

  /**
   * Coleta PF — só permitida pra orgs com `prospect_pf_cold_enabled=true`
   * (flag setada via migration 087 sob autorização jurídica explícita).
   *
   * ⚠️ Esta fase NÃO chama provider PF ainda — apenas cria a entity-mãe
   * + grava consent_ledger com base legal. O enrichment real (HubDev/
   * BigDataCorp/DataStone/PH3A pra CPF) acontece via bridge SaaS futuro
   * (precisa endpoint `/internal/enrichment/cpf` no eclick-backend).
   *
   * Guard menores de 18 — quando o enrichment vier, descarta entity se
   * data_nascimento indicar idade<18. Stub do guard fica em
   * applyMinorGuard() pra ser invocado quando o lookup CPF entrar.
   */
  private async collectPf(orgId: string, dto: CollectDto): Promise<{
    entity_id: string;
    status: 'created' | 'updated' | 'cached';
    source_used: string;
  }> {
    // 1) Flag por org
    const { data: enabled } = await this.activeDb.rpc(
      'prospect_is_pf_cold_enabled',
      { p_org_id: orgId },
    );
    if (!enabled) {
      throw new ForbiddenException(
        'Sua org não tem autorização pra coleta PF (exige validação jurídica + flag organizations.prospect_pf_cold_enabled=true).',
      );
    }

    // 2) CPF validação
    const cpf = onlyDigits(dto.cpf);
    if (!cpf || cpf.length !== 11) {
      throw new BadRequestException('CPF inválido (11 dígitos).');
    }

    // 3) Idempotência por (org_id, cpf)
    const { data: existing } = await this.db
      .from('entities')
      .select('id')
      .eq('org_id', orgId)
      .eq('cpf', cpf)
      .maybeSingle();

    let entityId: string;
    let status: 'created' | 'updated';
    if (existing) {
      entityId = (existing as { id: string }).id;
      status = 'updated';
    } else {
      const { data: created, error } = await this.db
        .from('entities')
        .insert({
          org_id: orgId,
          entity_type: 'pf',
          cpf,
          full_name: dto.seed?.['full_name'] ?? null,
          display_name: dto.seed?.['full_name'] ?? null,
          status: 'novo',
        })
        .select('id')
        .single();
      if (error) throw new BadRequestException(error.message);
      entityId = (created as { id: string }).id;
      status = 'created';
    }

    // 4) Consent ledger — base legal: legítimo interesse, com origin marcando
    //    a autorização jurídica interna (rastreável pra LGPD).
    const { data: existingConsent } = await this.db
      .from('consent_ledger')
      .select('id')
      .eq('entity_id', entityId)
      .eq('origin', 'internal_legal_release_2026_05_28')
      .limit(1)
      .maybeSingle();
    if (!existingConsent) {
      await this.db.from('prospect_consent_ledger').insert({
        entity_id: entityId,
        subject_kind: 'pf_lead',
        legal_basis: 'legitimo_interesse',
        origin: 'internal_legal_release_2026_05_28',
      });
    }

    // 5) Enrichment via bridge SaaS + resolver + score (async, não bloqueia)
    this.enrichPfAsync(orgId, entityId, cpf).catch(err =>
      this.log.error(`[post-collect-pf async] entity=${entityId}: ${(err as Error).message}`),
    );

    this.log.log(
      `[collect.pf] entity=${entityId} status=${status} — enrichment via bridge disparado`,
    );

    return {
      entity_id: entityId,
      status,
      source_used: 'saas_bridge_cpf',
    };
  }

  /** Pipeline pós-collect PF: enrich SaaS → guard menores → resolver → score. */
  private async enrichPfAsync(orgId: string, entityId: string, cpf: string): Promise<void> {
    const result = await this.saasBridge.enrichCpf(
      orgId,
      entityId,
      cpf,
      // callback se menor detectado
      async (birthDate) => {
        await this.applyMinorGuard(entityId, birthDate);
      },
    );
    this.log.log(
      `[collect.pf.enriched] entity=${entityId} ok=${result.ok} provider=${result.provider} ` +
      `cache=${result.cache_hit} contacts=${result.contacts_added} cost=${result.cost_cents}¢ ` +
      `minor=${result.minor_blocked}`,
    );

    // Se o minor guard descartou a entity, não roda resolver/score (gasto inútil)
    if (result.minor_blocked) return;

    await this.resolver.resolve(orgId, entityId);
    await this.scorer.scoreEntity(orgId, entityId);
  }

  /**
   * Guard de menores de 18.
   * Chamar quando enrichment retornar data_nascimento. Se idade<18:
   *   • marca entity.status='descartado'
   *   • grava signal 'minor_guard_triggered'
   *   • retorna true (caller deve abortar enrichment)
   *
   * Stub público pra collector CPF futuro invocar.
   */
  async applyMinorGuard(
    entityId: string,
    birthDateIso: string | null | undefined,
  ): Promise<boolean> {
    if (!birthDateIso) return false;
    const birth = new Date(birthDateIso);
    if (Number.isNaN(birth.getTime())) return false;
    const ageMs = Date.now() - birth.getTime();
    const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
    if (ageYears >= 18) return false;

    await this.db.from('prospect_entities').update({ status: 'descartado' }).eq('id', entityId);
    await this.db.from('prospect_signals').insert({
      entity_id: entityId,
      signal_type: 'minor_guard_triggered',
      value: { birth_date: birthDateIso, age_years: Math.floor(ageYears) },
      weight: 0,
    });
    this.log.warn(`[minor-guard] entity=${entityId} descartado (idade ${Math.floor(ageYears)})`);
    return true;
  }

  // ──────────────────────────────────────────────────────────────────
  // List + Get — leitura de entidades
  // ──────────────────────────────────────────────────────────────────
  async list(orgId: string, q: ListEntitiesQuery): Promise<ProspectEntityRow[]> {
    let query = this.db
      .from('entities')
      .select('*')
      .eq('org_id', orgId)
      .order('prospect_score', { ascending: false })
      .limit(Math.min(q.limit ?? 100, 500));
    if (q.status) query = query.eq('status', q.status);
    if (q.entity_type) query = query.eq('entity_type', q.entity_type);
    if (typeof q.min_score === 'number') query = query.gte('prospect_score', q.min_score);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    // signal_type filter: aplica em memória (raro o suficiente pra não otimizar agora).
    const rows = (data ?? []) as ProspectEntityRow[];
    if (!q.signal_type) return rows;
    const ids = rows.map(r => r.id);
    if (!ids.length) return [];
    const { data: sigRows } = await this.db
      .from('signals')
      .select('entity_id')
      .in('entity_id', ids)
      .eq('signal_type', q.signal_type);
    const matchSet = new Set((sigRows ?? []).map(r => (r as { entity_id: string }).entity_id));
    return rows.filter(r => matchSet.has(r.id));
  }

  async getProfile(orgId: string, entityId: string) {
    const { data: entity, error } = await this.db
      .from('entities')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!entity) throw new NotFoundException('Entity não encontrada');

    const [{ data: contacts }, { data: signals }, { data: consent }, { data: links }] =
      await Promise.all([
        this.db.from('prospect_contacts').select('*').eq('entity_id', entityId),
        this.db.from('prospect_signals').select('*').eq('entity_id', entityId).order('detected_at', { ascending: false }),
        this.db.from('prospect_consent_ledger').select('*').eq('entity_id', entityId).order('created_at', { ascending: false }),
        this.db.from('prospect_entity_links').select('*, raw_record:prospect_raw_records(id, source_id, collected_at)').eq('entity_id', entityId),
      ]);

    return {
      entity,
      contacts: contacts ?? [],
      signals: signals ?? [],
      consent_ledger: consent ?? [],
      provenance: links ?? [],
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Enrich — força próxima camada respeitando gate (S6/S7 implementam real)
  // ──────────────────────────────────────────────────────────────────
  async enrich(orgId: string, entityId: string, dto: EnrichDto): Promise<{ job_id: string; status: string; gate_reason: string | null; }> {
    const { data: entity } = await this.db
      .from('entities')
      .select('id, prospect_score, status')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .maybeSingle();
    if (!entity) throw new NotFoundException('Entity não encontrada');
    const e = entity as { id: string; prospect_score: number; status: string };

    // Gates de custo (Corte_1 ≥50 pra camada 1; Corte_2 ≥70 pra camada 2)
    let gateReason: string | null = null;
    if (!dto.bypass_gate) {
      if (dto.target_layer === 1 && e.prospect_score < 50) gateReason = 'score_below_corte_1';
      if (dto.target_layer === 2 && e.prospect_score < 70) gateReason = 'score_below_corte_2';
    }

    const { data: job, error } = await this.db
      .from('prospect_enrichment_jobs')
      .insert({
        entity_id: entityId,
        source_id: dto.source_id ?? null,
        target_layer: dto.target_layer,
        status: gateReason ? 'skipped_gate' : 'queued',
        gate_reason: gateReason,
      })
      .select('id, status')
      .single();
    if (error) throw new BadRequestException(error.message);
    const j = job as { id: string; status: string };
    this.log.warn(`[enrich.stub] entity=${entityId} layer=${dto.target_layer} → ${j.status} (gate=${gateReason ?? 'none'})`);
    return { job_id: j.id, status: j.status, gate_reason: gateReason };
  }

  // ──────────────────────────────────────────────────────────────────
  // Promote — vira contato + card no Funil do Active (S7 real)
  // ──────────────────────────────────────────────────────────────────
  async promote(orgId: string, entityId: string, dto: PromoteDto): Promise<{
    contact_id: string;
    deal_id: string;
    pipeline_id: string;
    stage_id: string;
    promoted_at: string;
    ai_pitch: string;
  }> {
    // 1) Entity + dados pra abordagem
    const { data: entity } = await this.db
      .from('entities')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .maybeSingle();
    if (!entity) throw new NotFoundException('Entity não encontrada');
    const e = entity as {
      id: string;
      cnpj: string | null;
      display_name: string | null;
      razao_social: string | null;
      nome_fantasia: string | null;
      cnae: string | null;
      situacao: string | null;
      prospect_score: number;
      status: string;
      promoted_contact_id: string | null;
    };

    // 2) Compliance gate — opt-out bloqueia
    const { data: optOut } = await this.db
      .from('consent_ledger')
      .select('id')
      .eq('entity_id', entityId)
      .not('opt_out_at', 'is', null)
      .limit(1)
      .maybeSingle();
    if (optOut) {
      throw new ForbiddenException('Entity com opt-out registrado — não pode promover.');
    }

    // 3) Já foi promovida antes?
    if (e.promoted_contact_id) {
      // Idempotente: retorna o que já existe sem duplicar deal.
      const { data: existingContact } = await this.activeDb
        .from('contacts')
        .select('id')
        .eq('id', e.promoted_contact_id)
        .maybeSingle();
      if (existingContact) {
        const { data: existingDeal } = await this.activeDb
          .from('deals')
          .select('id, pipeline_id, stage_id')
          .eq('contact_id', e.promoted_contact_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingDeal) {
          const d = existingDeal as { id: string; pipeline_id: string; stage_id: string };
          return {
            contact_id: e.promoted_contact_id,
            deal_id: d.id,
            pipeline_id: d.pipeline_id,
            stage_id: d.stage_id,
            promoted_at: new Date().toISOString(),
            ai_pitch: '(já promovido — retornando registro existente)',
          };
        }
      }
    }

    // 4) Garante pipeline + primeiro stage
    let pipelineId: string;
    let stageId: string;
    if (dto.pipeline_id) {
      pipelineId = dto.pipeline_id;
      const { data: firstStage } = await this.activeDb
        .from('pipeline_stages')
        .select('id')
        .eq('pipeline_id', pipelineId)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!firstStage) throw new BadRequestException('pipeline_id inválido (sem stages).');
      stageId = (firstStage as { id: string }).id;
    } else {
      const { data: ensured, error: ensErr } = await this.activeDb.rpc(
        'prospect_ensure_pipeline',
        { p_org_id: orgId },
      );
      if (ensErr) throw new BadRequestException(ensErr.message);
      const result = ensured as { pipeline_id: string; first_stage_id: string };
      pipelineId = result.pipeline_id;
      stageId = result.first_stage_id;
    }

    // 5) Contato principal — phone do primeiro contact phone se existir
    const { data: phoneContact } = await this.db
      .from('contacts')
      .select('value, confidence')
      .eq('entity_id', entityId)
      .eq('kind', 'phone')
      .order('confidence', { ascending: false })
      .limit(1)
      .maybeSingle();
    const phone = (phoneContact as { value: string } | null)?.value ?? null;

    // 6) Cria contact no Active (ou atualiza se já existe por CNPJ via custom_fields)
    const contactName =
      e.nome_fantasia || e.razao_social || e.display_name || `CNPJ ${e.cnpj ?? '?'}`;
    const customFields: Record<string, unknown> = {
      cnpj: e.cnpj,
      cnae: e.cnae,
      situacao: e.situacao,
      prospect_score: e.prospect_score,
      promotion_reason: dto.reason ?? null,
      promoted_at: new Date().toISOString(),
    };

    const { data: createdContact, error: contErr } = await this.activeDb
      .from('contacts')
      .insert({
        org_id: orgId,
        name: contactName,
        phone,
        source: 'prospect',
        tags: ['prospect-promoted'],
        prospect_entity_id: entityId,
        custom_fields: customFields,
        temperature: e.prospect_score >= 70 ? 'hot' : 'warm',
        score: e.prospect_score,
      })
      .select('id')
      .single();
    if (contErr) throw new BadRequestException(`Falha ao criar contact: ${contErr.message}`);
    const contactId = (createdContact as { id: string }).id;

    // 7) Gera pitch sugerido (heurístico — S7 MVP; refina com LLM em fase futura)
    const aiPitch = await this.buildPitch(entityId, e);

    // 8) Cria deal no Funil
    const { data: createdDeal, error: dealErr } = await this.activeDb
      .from('deals')
      .insert({
        org_id: orgId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        contact_id: contactId,
        title: `${contactName}${e.cnpj ? ` (${this.formatCnpj(e.cnpj)})` : ''}`,
        ai_score: e.prospect_score,
        ai_next_action: 'Enviar abordagem inicial (ver custom_fields.ai_pitch)',
        custom_fields: {
          prospect_entity_id: entityId,
          prospect_score: e.prospect_score,
          ai_pitch: aiPitch,
          source: 'prospect_module',
        },
        tags: ['prospect'],
      })
      .select('id')
      .single();
    if (dealErr) {
      // Rollback parcial: deixa contact criado (não é fatal — fica órfão até retry).
      this.log.error(`[promote] deal create fail: ${dealErr.message}`);
      throw new BadRequestException(`Falha ao criar deal: ${dealErr.message}`);
    }
    const dealId = (createdDeal as { id: string }).id;

    // 9) Atualiza entity
    const now = new Date().toISOString();
    await this.db
      .from('entities')
      .update({
        status: 'promovido',
        promoted_at: now,
        promoted_contact_id: contactId,
      })
      .eq('id', entityId);

    this.log.log(`[promote] entity=${entityId} → contact=${contactId} deal=${dealId} pipeline=${pipelineId}`);
    return {
      contact_id: contactId,
      deal_id: dealId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      promoted_at: now,
      ai_pitch: aiPitch,
    };
  }

  /** Gera texto de abordagem heurístico baseado em signals + entity. */
  private async buildPitch(
    entityId: string,
    e: { display_name: string | null; cnae: string | null; situacao: string | null; prospect_score: number; },
  ): Promise<string> {
    const { data: signals } = await this.db
      .from('signals')
      .select('signal_type, value')
      .eq('entity_id', entityId);
    const sigList = (signals ?? []) as Array<{ signal_type: string; value: Record<string, unknown> | null }>;

    const hooks: string[] = [];
    const reviews = sigList.find(s => s.signal_type === 'places_reviews');
    if (reviews?.value) {
      const rating = Number(reviews.value['rating'] ?? 0);
      const count = Number(reviews.value['count'] ?? 0);
      if (rating >= 4.5) hooks.push(`Nota ${rating} no Google com ${count} avaliações`);
    }
    if (sigList.find(s => s.signal_type === 'marketplace_seller')) {
      hooks.push('Seller ativo em marketplace');
    }
    if (e.cnae?.startsWith('47')) hooks.push('CNAE de varejo (ICP forte)');

    const name = e.display_name ?? 'a empresa';
    const score = e.prospect_score;
    const summary = hooks.length
      ? `Sinais: ${hooks.join(' · ')}.`
      : 'Sinais limitados nesta camada — considerar enriquecer (camada 1) antes da abordagem.';
    return [
      `Lead: ${name} (Prospect Score: ${score}/100).`,
      summary,
      score >= 70
        ? 'Abordagem sugerida: WhatsApp citando o gargalo de operação (reputação, mediações, falta de e-commerce próprio).'
        : 'Sugerido: qualificar mais antes de abordar (aguardar camada 1 de enriquecimento).',
    ].join('\n');
  }

  private formatCnpj(c: string): string {
    if (!c || c.length !== 14) return c;
    return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
  }

  // ──────────────────────────────────────────────────────────────────
  // Opt-out interno (autenticado)
  // ──────────────────────────────────────────────────────────────────
  async optOutInternal(orgId: string, entityId: string, reason?: string) {
    const { data: entity } = await this.db
      .from('entities')
      .select('id, entity_type')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .maybeSingle();
    if (!entity) throw new NotFoundException('Entity não encontrada');
    const e = entity as { id: string; entity_type: 'pj' | 'pf' };

    const { error } = await this.db.from('prospect_consent_ledger').insert({
      entity_id: entityId,
      subject_kind: e.entity_type === 'pj' ? 'pj' : 'pf_lead',
      legal_basis: 'consentimento',
      origin: 'internal_optout',
      opt_out_at: new Date().toISOString(),
      opt_out_reason: reason ?? null,
    });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ──────────────────────────────────────────────────────────────────
  // Opt-out PÚBLICO (sem auth — usado pelo endpoint /public/prospect/opt-out)
  // ──────────────────────────────────────────────────────────────────
  async optOutPublic(dto: OptOutPublicDto, requesterIp: string) {
    const cnpj = onlyDigits(dto.cnpj);
    const cpf = onlyDigits(dto.cpf);
    if (!cnpj && !cpf) throw new BadRequestException('Forneça cnpj ou cpf.');
    if (cnpj && cnpj.length !== 14) throw new BadRequestException('CNPJ deve ter 14 dígitos.');
    if (cpf && cpf.length !== 11) throw new BadRequestException('CPF deve ter 11 dígitos.');
    if (!dto.requester_email?.includes('@')) {
      throw new BadRequestException('requester_email obrigatório.');
    }

    // Acha todas as entidades em qualquer org que tenham esse documento.
    let q = this.db.from('prospect_entities').select('id, org_id, entity_type');
    if (cnpj) q = q.eq('cnpj', cnpj);
    if (cpf) q = q.eq('cpf', cpf);
    const { data: entities, error } = await q;
    if (error) throw new BadRequestException(error.message);

    const list = (entities ?? []) as Array<{ id: string; org_id: string; entity_type: 'pj' | 'pf' }>;
    if (!list.length) {
      // Não revela ausência (LGPD-friendly) — sempre 200.
      this.log.warn(`[opt-out.public] documento sem entity (cnpj=${!!cnpj} cpf=${!!cpf}) ip=${requesterIp}`);
      return { ok: true, affected: 0 };
    }

    const optOutAt = new Date().toISOString();
    const rows = list.map(e => ({
      entity_id: e.id,
      subject_kind: e.entity_type === 'pj' ? 'pj' : 'pf_lead',
      legal_basis: 'consentimento' as const,
      origin: 'public_optout_form',
      origin_ip: requesterIp,
      opt_out_at: optOutAt,
      opt_out_reason: dto.reason ?? `Solicitado por ${dto.requester_email}`,
    }));
    const { error: insErr } = await this.db.from('prospect_consent_ledger').insert(rows);
    if (insErr) throw new BadRequestException(insErr.message);

    this.log.log(`[opt-out.public] ${list.length} entity(s) com opt-out registrado (cnpj=${!!cnpj} cpf=${!!cpf})`);
    return { ok: true, affected: list.length };
  }

  // ──────────────────────────────────────────────────────────────────
  // Match Review
  // ──────────────────────────────────────────────────────────────────
  async listMatchReview(orgId: string) {
    const { data, error } = await this.db
      .from('prospect_match_review')
      .select('*, a:prospect_entities!entity_a(id, display_name, cnpj, prospect_score), b:prospect_entities!entity_b(id, display_name, cnpj, prospect_score)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new BadRequestException(error.message);
    // RLS via PostgREST não roda aqui (service_role bypassa). Filtra org_id na A.
    const rows = (data ?? []) as Array<{ a: { id: string } | null }>;
    // O join trouxe `a` e `b` da mesma org (porque match_review escopa por entity_a.org_id).
    // Como service_role bypassa RLS, vou filtrar manualmente pra não vazar.
    const filtered: typeof rows = [];
    for (const r of rows) {
      if (!r.a) continue;
      const { data: aOrg } = await this.db
        .from('entities')
        .select('org_id')
        .eq('id', r.a.id)
        .maybeSingle();
      if ((aOrg as { org_id: string } | null)?.org_id === orgId) filtered.push(r);
    }
    return filtered;
  }

  async resolveMatch(orgId: string, matchId: string, userId: string, dto: ResolveMatchDto) {
    // S5 implementa o merge real (atualiza entity_links, contacts, signals do "loser").
    this.log.warn(`[resolveMatch.stub] match=${matchId} decision=${dto.decision} — S5 ainda não implementa merge`);
    const { data, error } = await this.db
      .from('prospect_match_review')
      .update({
        status: dto.decision === 'merge' ? 'merged' : 'rejected',
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        notes: dto.notes ?? null,
      })
      .eq('id', matchId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ──────────────────────────────────────────────────────────────────
  // CAC Report
  // ──────────────────────────────────────────────────────────────────
  async cacReport(orgId: string): Promise<CacReport> {
    // Agrega via raw_records.cost_cents + entities promovidas.
    const { data: rawAgg } = await this.db
      .from('prospect_raw_records')
      .select('source_id, cost_cents')
      .eq('org_id', orgId);

    const bySource = new Map<string, { calls: number; cost: number; promoted: number }>();
    for (const r of (rawAgg ?? []) as Array<{ source_id: string; cost_cents: number }>) {
      const cur = bySource.get(r.source_id) ?? { calls: 0, cost: 0, promoted: 0 };
      cur.calls += 1;
      cur.cost += r.cost_cents ?? 0;
      bySource.set(r.source_id, cur);
    }

    // Contagem de promoted total (sem distribuição por fonte — S7 vai gravar attribution).
    const { count: totalPromoted } = await this.db
      .from('entities')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'promovido');

    const result: CacReport = {
      by_source: Array.from(bySource.entries()).map(([source_id, v]) => ({
        source_id,
        calls: v.calls,
        cost_cents_total: v.cost,
        promoted_count: v.promoted,
        cac_cents_per_promoted: v.promoted > 0 ? Math.round(v.cost / v.promoted) : null,
      })),
      total_cost_cents: Array.from(bySource.values()).reduce((acc, v) => acc + v.cost, 0),
      total_promoted: totalPromoted ?? 0,
    };
    return result;
  }
}
