import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { EmbeddingsClient } from '../knowledge/embeddings.client';
import { normalizeNameForEmbedding } from './normalizer';

/**
 * Entity Resolver — une duplicados em prospect.entities.
 *
 * Estratégia em camadas (ordem de barateza/confiança):
 *
 *   1. Determinístico por CNPJ — feito direto no collector (upsert por
 *      (org_id, cnpj)). Não precisa do resolver.
 *
 *   2. Semântico via pgvector cosine — esse resolver:
 *      • Gera/atualiza name_vec da entity (text-embedding-3-small, 1536d).
 *      • Busca similares na mesma org via RPC `prospect_find_similar_entities`.
 *      • similarity >= 90 → merge AUTO (vincula raw_records do "loser" pro
 *        "winner" e marca loser como status='descartado').
 *      • similarity 80–89 → enfileira em match_review (NUNCA merge cego).
 *      • similarity < 80 → ignora.
 *
 * O "winner" é escolhido por: tem CNPJ > não tem; mais consent_ledger; mais
 * raw_records (i.e. mais provenance = mais confiança).
 */
@Injectable()
export class EntityResolverService {
  private readonly log = new Logger(EntityResolverService.name);

  private readonly AUTO_MERGE_THRESHOLD = 90;
  private readonly REVIEW_MIN_THRESHOLD = 80;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly embeddings: EmbeddingsClient,
  ) {}

  private get db() {
    return this.supabase.adminClient;
  }

  private get rpc() {
    return this.supabase.adminClient;
  }

  /**
   * Gera embedding p/ a entity e tenta resolver matches.
   * Retorna o que aconteceu (resultado por banco/UI).
   */
  async resolve(orgId: string, entityId: string): Promise<{
    embedding_generated: boolean;
    auto_merged_with: string | null;
    enqueued_for_review: Array<{ id: string; similarity: number }>;
  }> {
    const { data: entity } = await this.db
      .from('prospect_entities')
      .select('id, display_name, razao_social, nome_fantasia, cnpj')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .maybeSingle();
    if (!entity) {
      this.log.warn(`[resolver] entity ${entityId} não encontrada`);
      return { embedding_generated: false, auto_merged_with: null, enqueued_for_review: [] };
    }
    const e = entity as { id: string; display_name: string | null; razao_social: string | null; nome_fantasia: string | null; cnpj: string | null };

    // Constrói texto pra embedding (nome de melhor qualidade disponível)
    const baseName =
      e.razao_social || e.nome_fantasia || e.display_name || '';
    const normalized = normalizeNameForEmbedding(baseName);
    if (!normalized) {
      this.log.warn(`[resolver] entity ${entityId} sem nome — pula embedding`);
      return { embedding_generated: false, auto_merged_with: null, enqueued_for_review: [] };
    }

    // 1) Gera embedding
    const vec = await this.embeddings.embed(normalized, orgId);
    if (!vec) {
      // Org sem OpenAI key, ou falha — não bloqueia, só não tem entity resolution semântica.
      this.log.warn(`[resolver] embedding indisponível org=${orgId} entity=${entityId}`);
      return { embedding_generated: false, auto_merged_with: null, enqueued_for_review: [] };
    }

    // 2) Atualiza name_vec via RPC (schema prospect não exposto direto)
    const { error: upErr } = await this.rpc.rpc('prospect_update_name_vec', {
      p_entity_id: entityId,
      p_name_vec: vec as unknown as string, // pgvector aceita array
    });
    if (upErr) {
      this.log.error(`[resolver] update name_vec fail: ${upErr.message}`);
      return { embedding_generated: false, auto_merged_with: null, enqueued_for_review: [] };
    }

    // 3) Busca similares
    const { data: similars, error: simErr } = await this.rpc.rpc(
      'prospect_find_similar_entities',
      {
        p_org_id: orgId,
        p_name_vec: vec as unknown as string,
        p_threshold: this.REVIEW_MIN_THRESHOLD / 100,
        p_exclude_id: entityId,
        p_limit: 5,
      },
    );
    if (simErr) {
      this.log.error(`[resolver] find_similar fail: ${simErr.message}`);
      return { embedding_generated: true, auto_merged_with: null, enqueued_for_review: [] };
    }

    const matches = (similars ?? []) as Array<{
      id: string;
      display_name: string | null;
      cnpj: string | null;
      similarity: number;
    }>;

    if (!matches.length) {
      return { embedding_generated: true, auto_merged_with: null, enqueued_for_review: [] };
    }

    // 4) Classifica
    const top = matches[0]!;
    if (top.similarity >= this.AUTO_MERGE_THRESHOLD) {
      // Auto-merge: se ambos têm CNPJ DIFERENTE, NÃO merge (são empresas distintas com nomes parecidos).
      if (e.cnpj && top.cnpj && e.cnpj !== top.cnpj) {
        this.log.warn(
          `[resolver] similarity ${top.similarity} mas CNPJs diferem (${e.cnpj} vs ${top.cnpj}) — sem merge`,
        );
        return { embedding_generated: true, auto_merged_with: null, enqueued_for_review: [] };
      }
      const winner = await this.pickWinner(e.id, top.id);
      const loser = winner === e.id ? top.id : e.id;
      await this.merge(winner, loser);
      this.log.log(`[resolver] AUTO-merge winner=${winner} loser=${loser} similarity=${top.similarity}`);
      return {
        embedding_generated: true,
        auto_merged_with: top.id,
        enqueued_for_review: matches.slice(1)
          .filter(m => m.similarity >= this.REVIEW_MIN_THRESHOLD && m.similarity < this.AUTO_MERGE_THRESHOLD)
          .map(m => ({ id: m.id, similarity: m.similarity })),
      };
    }

    // 5) similarity 80–89 → fila de revisão humana
    const enqueued: Array<{ id: string; similarity: number }> = [];
    for (const m of matches) {
      if (m.similarity < this.REVIEW_MIN_THRESHOLD) continue;
      if (m.similarity >= this.AUTO_MERGE_THRESHOLD) continue; // top já tratado acima
      const { error: regErr } = await this.rpc.rpc('prospect_register_match', {
        p_entity_a: entityId,
        p_entity_b: m.id,
        p_similarity: m.similarity,
        p_method: 'semantic',
        p_context: { source: 'entity-resolver', base_name: normalized.slice(0, 100) },
      });
      if (regErr) {
        this.log.error(`[resolver] register_match fail: ${regErr.message}`);
        continue;
      }
      enqueued.push({ id: m.id, similarity: m.similarity });
    }

    return { embedding_generated: true, auto_merged_with: null, enqueued_for_review: enqueued };
  }

  /**
   * Decide qual entity sobrevive ao merge:
   * 1. Tem CNPJ > não tem
   * 2. Mais raw_records (provenance)
   * 3. Mais antiga (created_at menor)
   */
  private async pickWinner(idA: string, idB: string): Promise<string> {
    const { data } = await this.db
      .from('prospect_entities')
      .select('id, cnpj, created_at')
      .in('id', [idA, idB]);
    const rows = (data ?? []) as Array<{ id: string; cnpj: string | null; created_at: string }>;
    if (rows.length < 2) return idA;

    const [a, b] = rows[0]!.id === idA ? [rows[0]!, rows[1]!] : [rows[1]!, rows[0]!];

    // 1) Tem CNPJ ganha
    if (a.cnpj && !b.cnpj) return a.id;
    if (b.cnpj && !a.cnpj) return b.id;

    // 2) Mais raw_records
    const [cntA, cntB] = await Promise.all([
      this.db.from('prospect_entity_links').select('id', { count: 'exact', head: true }).eq('entity_id', a.id),
      this.db.from('prospect_entity_links').select('id', { count: 'exact', head: true }).eq('entity_id', b.id),
    ]);
    const linksA = (cntA as { count: number | null }).count ?? 0;
    const linksB = (cntB as { count: number | null }).count ?? 0;
    if (linksA !== linksB) return linksA > linksB ? a.id : b.id;

    // 3) Mais antiga
    return new Date(a.created_at) <= new Date(b.created_at) ? a.id : b.id;
  }

  /**
   * Merge: transfere entity_links, contacts, signals e consent do loser pro
   * winner; marca loser como status='descartado'.
   */
  private async merge(winnerId: string, loserId: string): Promise<void> {
    // entity_links: re-aponta para winner
    await this.db.from('prospect_entity_links').update({ entity_id: winnerId }).eq('entity_id', loserId);

    // contacts: re-aponta para winner (UNIQUE constraint pode colidir — pegar erro silenciosamente)
    const { data: loserContacts } = await this.db
      .from('prospect_contacts')
      .select('kind, value, validated_in, confidence, is_pii, last_validated_at')
      .eq('entity_id', loserId);
    for (const c of (loserContacts ?? []) as Array<Record<string, unknown>>) {
      // tenta upsert (UNIQUE entity_id+kind+value)
      const { error } = await this.db.from('prospect_contacts').insert({ entity_id: winnerId, ...c });
      if (error && !error.message.includes('duplicate key')) {
        this.log.warn(`[merge] contact insert: ${error.message}`);
      }
    }
    await this.db.from('prospect_contacts').delete().eq('entity_id', loserId);

    // signals + consent: re-apontam
    await this.db.from('prospect_signals').update({ entity_id: winnerId }).eq('entity_id', loserId);
    await this.db.from('prospect_consent_ledger').update({ entity_id: winnerId }).eq('entity_id', loserId);

    // marca loser
    await this.db
      .from('prospect_entities')
      .update({ status: 'descartado' })
      .eq('id', loserId);
  }
}
