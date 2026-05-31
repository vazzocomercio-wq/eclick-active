import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { LlmService } from '../../common/llm/llm.service';

const EMBED_MODEL = 'text-embedding-3-small'; // 1536 dims (bate com a coluna)
/** Similaridade pra considerar "mesmo padrão" (dedup → incrementa observations). */
const DEDUP_SIMILARITY = 0.92;
/** Similaridade mínima pra um padrão entrar no RAG do ANALYZE. */
const RETRIEVE_SIMILARITY = 0.7;

export interface LearnInput {
  orgId: string;
  platform: string;
  objective: string | null;
  decisionId: string;
  type: string;
  verdict: 'positive' | 'negative' | 'neutral';
  cpaChangePct: number | null;
  windowHours: number;
}

interface KnowledgeHit {
  id: string;
  pattern: string;
  confidence: number;
  observations: number;
  similarity: number;
}

/**
 * MVP-3c — LOOP DE APRENDIZADO (KB vetorizada). Destila cada outcome num
 * PADRÃO aprendido, vetoriza (OpenAI) e guarda em active.ads_knowledge. No
 * ANALYZE, recupera padrões relevantes (RAG via RPC ads_knowledge_search) pra
 * SOBREPOR o playbook estático. Tudo best-effort: sem chave OpenAI, pula
 * gracioso (o motor segue só com o playbook).
 */
@Injectable()
export class AdsKnowledgeService {
  private readonly logger = new Logger(AdsKnowledgeService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
  ) {}

  /** Destila + grava o aprendizado de uma decisão medida. */
  async learnFromOutcome(input: LearnInput): Promise<void> {
    const pattern = buildPattern(input);
    const embedding = await this.embed(input.orgId, pattern);
    if (!embedding) return; // sem chave/erro → não vetoriza, pula

    const vec = toVectorLiteral(embedding);
    const context = {
      platform: input.platform,
      objective: input.objective,
      action: input.type,
      verdict: input.verdict,
      cpa_change_pct: input.cpaChangePct,
      window_hours: input.windowHours,
    };

    // dedup por similaridade (mesmo padrão já visto → reforça)
    const top = await this.searchTop(input.orgId, input.platform, vec);
    if (top && top.similarity >= DEDUP_SIMILARITY) {
      const { error } = await this.supabase.adminClient
        .from('ads_knowledge')
        .update({
          observations: top.observations + 1,
          confidence: Math.min(0.95, top.confidence + 0.08),
          updated_at: new Date().toISOString(),
        })
        .eq('id', top.id);
      if (error) this.logger.warn(`KB reforço falhou: ${error.message}`);
      else this.logger.log(`KB reforçada (${top.observations + 1}x): ${top.pattern.slice(0, 60)}`);
      return;
    }

    const { error } = await this.supabase.adminClient.from('ads_knowledge').insert({
      org_id: input.orgId,
      platform: input.platform,
      pattern,
      context,
      confidence: input.verdict === 'neutral' ? 0.4 : 0.6,
      observations: 1,
      embedding: vec,
      source_decision_ids: [input.decisionId],
    });
    if (error) this.logger.warn(`KB insert falhou: ${error.message}`);
    else this.logger.log(`KB novo padrão: ${pattern.slice(0, 70)}`);
  }

  /** RAG — padrões relevantes pro contexto atual (strings prontas pro prompt). */
  async retrieve(orgId: string, platform: string, contextText: string, limit = 5): Promise<string[]> {
    const embedding = await this.embed(orgId, contextText);
    if (!embedding) return [];
    const { data, error } = await this.supabase.adminClient.rpc('ads_knowledge_search', {
      p_org_id: orgId,
      p_embedding: toVectorLiteral(embedding),
      p_platform: platform,
      p_limit: limit,
    });
    if (error) {
      this.logger.warn(`ads_knowledge_search falhou: ${error.message}`);
      return [];
    }
    return ((data ?? []) as KnowledgeHit[])
      .filter((h) => h.similarity >= RETRIEVE_SIMILARITY)
      .map((h) => h.pattern);
  }

  // ── internals ──────────────────────────────────────────────

  private async searchTop(orgId: string, platform: string, vec: string): Promise<KnowledgeHit | null> {
    const { data, error } = await this.supabase.adminClient.rpc('ads_knowledge_search', {
      p_org_id: orgId,
      p_embedding: vec,
      p_platform: platform,
      p_limit: 1,
    });
    if (error) {
      this.logger.warn(`ads_knowledge_search (dedup) falhou: ${error.message}`);
      return null;
    }
    const hits = (data ?? []) as KnowledgeHit[];
    return hits[0] ?? null;
  }

  /** Embedding via OpenAI. Retorna null se não há chave (pula gracioso). */
  private async embed(orgId: string, text: string): Promise<number[] | null> {
    let key: string | null;
    try {
      key = await this.llm.resolveOpenAiKey(orgId, { allowNull: true });
    } catch {
      key = null;
    }
    if (!key) return null;
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000) }),
      });
      if (!res.ok) {
        this.logger.warn(`OpenAI embeddings ${res.status}`);
        return null;
      }
      const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
      const emb = json.data?.[0]?.embedding;
      return Array.isArray(emb) && emb.length > 0 ? emb : null;
    } catch (err) {
      this.logger.warn(`embed falhou: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}

// ────────────────────────────────────────────
// template do padrão (determinístico → bom pra dedup)
// ────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = {
  scale_budget: 'escalar orçamento',
  reduce_budget: 'reduzir orçamento',
  pause: 'pausar a campanha',
  activate: 'reativar a campanha',
  adjust_bid: 'ajustar lance',
  reallocate: 'realocar verba',
};

function buildPattern(i: LearnInput): string {
  const obj = i.objective ?? 'geral';
  const action = ACTION_LABEL[i.type] ?? i.type;
  const cpa = i.cpaChangePct != null
    ? ` (custo-por-resultado ${i.cpaChangePct <= 0 ? 'caiu' : 'subiu'} ${Math.abs(Math.round(i.cpaChangePct))}% em ${i.windowHours}h)`
    : ` (medido em ${i.windowHours}h)`;
  if (i.verdict === 'positive') {
    return `[${i.platform}/${obj}] ${action} FUNCIONOU${cpa}. Repetir em contexto parecido.`;
  }
  if (i.verdict === 'negative') {
    return `[${i.platform}/${obj}] ${action} PIOROU o resultado${cpa}. Evitar nesse contexto.`;
  }
  return `[${i.platform}/${obj}] ${action} teve efeito neutro${cpa}.`;
}

/** number[] → literal pgvector '[v1,v2,...]' (PostgREST casta texto→vector). */
function toVectorLiteral(arr: number[]): string {
  return `[${arr.join(',')}]`;
}
