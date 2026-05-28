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
import { EntityResolverService } from './entity-resolver.service';
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
    private readonly resolver: EntityResolverService,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  // Discovery — Google Places (S4)
  // ──────────────────────────────────────────────────────────────────
  async discoverPlaces(orgId: string, dto: DiscoverPlacesDto) {
    const result = await this.places.discoverByText(orgId, {
      query: dto.query,
      region: dto.region,
      maxResults: dto.max_results,
    });
    // S5: dispara entity resolver pra cada entity nova/atualizada.
    // Async sem await — não bloqueia a resposta (errors logam, não estouram).
    for (const ent of result.entities) {
      this.resolver.resolve(orgId, ent.id).catch(err =>
        this.log.error(`[resolver async] entity=${ent.id}: ${(err as Error).message}`),
      );
    }
    return result;
  }

  /** Endpoint manual: força re-resolução de uma entity (gera embedding + match). */
  async resolveEntity(orgId: string, entityId: string) {
    return this.resolver.resolve(orgId, entityId);
  }

  /** Cliente Supabase com schema `prospect` pré-selecionado. */
  private get db() {
    return this.supabase.adminClient.schema('prospect' as 'public');
  }

  /** Cliente raw (schema padrão) — usado pra ler/escrever em `active.*`. */
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
    if (dto.entity_type === 'pf') {
      // Coleta FRIA de PF é proibida por decisão de produto (LGPD).
      // PF só entra via opt-in/inbound (form, TikTok Live, cliente existente).
      throw new ForbiddenException(
        'Coleta fria de PF não é permitida. PF só entra via opt-in/inbound.',
      );
    }
    const cnpj = onlyDigits(dto.cnpj);
    if (!cnpj || cnpj.length !== 14) {
      throw new BadRequestException('CNPJ inválido (14 dígitos).');
    }

    // Routing por source_id. Default = brasilapi_cnpj (camada 0 grátis).
    const sourceId = dto.source_id ?? 'brasilapi_cnpj';

    if (sourceId === 'brasilapi_cnpj' || sourceId === 'receita_aberta') {
      const result = await this.brasilApi.collect(orgId, cnpj);
      // S5: dispara resolver async (não bloqueia)
      this.resolver.resolve(orgId, result.entity_id).catch(err =>
        this.log.error(`[resolver async] entity=${result.entity_id}: ${(err as Error).message}`),
      );
      return {
        entity_id: result.entity_id,
        status: result.status,
        source_used: 'brasilapi_cnpj',
      };
    }

    // Outras fontes vão entrar nas próximas sprints (S4 Places; S5+ bridge SaaS).
    throw new BadRequestException(
      `Fonte '${sourceId}' ainda não implementada na Fase 0. Disponível: brasilapi_cnpj.`,
    );
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
        this.db.from('contacts').select('*').eq('entity_id', entityId),
        this.db.from('signals').select('*').eq('entity_id', entityId).order('detected_at', { ascending: false }),
        this.db.from('consent_ledger').select('*').eq('entity_id', entityId).order('created_at', { ascending: false }),
        this.db.from('entity_links').select('*, raw_record:raw_records(id, source_id, collected_at)').eq('entity_id', entityId),
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
      .from('enrichment_jobs')
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
  // Promote — vira contato no Active (S7 implementa o bridge real)
  // ──────────────────────────────────────────────────────────────────
  async promote(orgId: string, entityId: string, _dto: PromoteDto): Promise<{ contact_id: string | null; promoted_at: string; }> {
    const { data: entity } = await this.db
      .from('entities')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .maybeSingle();
    if (!entity) throw new NotFoundException('Entity não encontrada');

    // Compliance gate — opt-out bloqueia
    const { data: optOut } = await this.db
      .from('consent_ledger')
      .select('id')
      .eq('entity_id', entityId)
      .not('opt_out_at', 'is', null)
      .limit(1)
      .maybeSingle();
    if (optOut) throw new ForbiddenException('Entity com opt-out registrado — não pode promover.');

    this.log.warn(`[promote.stub] entity=${entityId} — S7 (bridge p/ active.contacts) ainda não implementado`);
    const now = new Date().toISOString();
    await this.db
      .from('entities')
      .update({ status: 'promovido', promoted_at: now })
      .eq('id', entityId);
    return { contact_id: null, promoted_at: now };
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

    const { error } = await this.db.from('consent_ledger').insert({
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
    let q = this.db.from('entities').select('id, org_id, entity_type');
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
    const { error: insErr } = await this.db.from('consent_ledger').insert(rows);
    if (insErr) throw new BadRequestException(insErr.message);

    this.log.log(`[opt-out.public] ${list.length} entity(s) com opt-out registrado (cnpj=${!!cnpj} cpf=${!!cpf})`);
    return { ok: true, affected: list.length };
  }

  // ──────────────────────────────────────────────────────────────────
  // Match Review
  // ──────────────────────────────────────────────────────────────────
  async listMatchReview(orgId: string) {
    const { data, error } = await this.db
      .from('match_review')
      .select('*, a:entities!entity_a(id, display_name, cnpj, prospect_score), b:entities!entity_b(id, display_name, cnpj, prospect_score)')
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
      .from('match_review')
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
      .from('raw_records')
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
