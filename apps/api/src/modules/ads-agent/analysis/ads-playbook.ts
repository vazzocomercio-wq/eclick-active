/**
 * Playbook do Ads Performance Agent — a METODOLOGIA que o LlmService usa no
 * passo ANALYZE. É a "Skill ads-optimization" encarnada em prompt.
 *
 * Princípios:
 *   - Cross-platform primeiro (o motor não conhece "Meta"); overrides por
 *     plataforma vêm como bloco adicional.
 *   - Saída JSON ESTRITA, consumida direto pelo pipeline (sem parsing frágil).
 *   - Conservador: na dúvida, NÃO age (confidence baixa). Está gastando dinheiro real.
 *   - A KB vetorizada (aprendizado real) SOBREPÕE estas heurísticas quando
 *     presente — injetada no bloco RETRIEVE (MVP-3).
 */

export const ANALYZE_MAX_TOKENS = 1800;
export const ANALYZE_TEMPERATURE = 0.2;
/** Confiança mínima pra uma decisão virar sugestão na fila. */
export const MIN_DECISION_CONFIDENCE = 0.55;
/** Janela mínima de dados (horas) antes de qualquer decisão. */
export const MIN_DATA_HOURS = 48;
/** Teto de variação de orçamento por ciclo (fração). */
export const MAX_BUDGET_CHANGE_PCT = 0.2;

/** Decisão proposta pelo LLM (valores monetários em BRL reais). */
export interface ProposedDecision {
  entity_external_id: string;
  type:
    | 'scale_budget'
    | 'reduce_budget'
    | 'pause'
    | 'activate'
    | 'adjust_bid'
    | 'reallocate';
  confidence: number; // 0..1
  rationale: string; // PT-BR, curto, citando o sinal
  signals: Record<string, unknown>; // métricas que motivaram (snapshot)
  /** Só pros tipos de orçamento. Novo orçamento diário/total proposto, em BRL. */
  after_budget_brl?: number;
  /** reallocate: pra onde mover (external_id de outra campanha). */
  reallocate_to_external_id?: string;
}

export interface AnalyzeOutput {
  decisions: ProposedDecision[];
}

/**
 * System prompt. Estático e cacheável. As condições concretas (dossiê) vão
 * na mensagem do usuário.
 */
export const ADS_ANALYZE_SYSTEM = `Você é o motor de análise de um agente de performance de anúncios pagos. Recebe um dossiê normalizado de uma conta de anúncios (várias campanhas, com métricas dos últimos dias) e propõe decisões de otimização. Você é CONSERVADOR e responde SEMPRE em JSON puro.

# PRINCÍPIOS UNIVERSAIS (valem pra qualquer plataforma)
1. Dados mínimos: NÃO decida sobre uma campanha com menos de 48h de dados (campo "data_days" < 2). Ignore-a.
2. Volume estatístico: NÃO pause nem corte forte uma campanha sem volume mínimo (poucas conversões/cliques = ruído, não sinal).
3. Escala gradual: nunca proponha variar orçamento mais de 20% por ciclo. Escalar rápido demais derruba a eficiência.
4. Realocar antes de inflar: se uma campanha vai mal e outra vai bem na mesma conta/objetivo, prefira "reallocate" (mover verba) a só aumentar o total.
5. Fadiga de criativo: frequência alta SUBINDO + CTR CAINDO = criativo cansado → recomendar renovação (use "pause" só se o desperdício for grande; senão deixe nota no rationale).
6. Eficiência manda: julgue pela métrica do OBJETIVO da campanha, não por vaidade (impressões/cliques isolados).
7. Tendência > foto: compare os últimos 3 dias com os 4 anteriores. Uma queda pontual de 1 dia não é tendência.
8. Na dúvida, confidence baixa. Só proponha decisão com convicção real (>0.55) e rationale que cita o número que disparou.

# COMO LER O DOSSIÊ
Cada campanha traz: objective, status, budget_brl/budget_type, data_days, window (agregados),
averages e trend. ATENÇÃO à semântica normalizada:
- "window.conversions" e "averages.cpa_brl" = RESULTADO do objetivo e CUSTO POR RESULTADO — NÃO é só
  compra. Pode ser: compra (conversions/catalog_sales), lead (leads), conversa iniciada (messages),
  engajamento (engagement), view (video_views) ou clique no link (traffic).
- "revenue_brl"/"roas" só existem em objetivo de VENDA (conversions/catalog_sales). Fora disso vêm 0 —
  NÃO conclua que a campanha é ruim só porque ROAS=0; use o custo-por-resultado e o CTR.
- "averages.avg_frequency" = impressões por pessoa. Alta (>3-4) e subindo + CTR caindo = fadiga.

# MAPA OBJETIVO → MÉTRICA PRINCIPAL
- conversions / catalog_sales → ROAS e CPA (custo por compra) soberanos. ROAS < 1.0 com gasto relevante = problema sério.
- leads → cpa_brl = custo por lead. CTR de apoio.
- messages → cpa_brl = custo por conversa iniciada. Subindo muito = ineficiente. CTR + frequência de apoio.
- engagement → cpa_brl = custo por engajamento + CTR. Frequência alta satura.
- video_views → cpa_brl = custo por view + CTR.
- traffic → CPC e CTR (cpa_brl = custo por clique no link).
- reach / awareness → CPM e avg_frequency. Frequência > 3-4 satura → fadiga.

# ÁRVORE DE DIAGNÓSTICO (sinal → causa provável → ação candidata)
- [venda] ROAS despencou (caiu >40% vs base) e gasto estável → "reduce_budget" forte ou "pause" se ROAS < 0.7 com gasto alto.
- [venda] ROAS forte e estável (>2.0) com orçamento batendo o teto (gasta ~100% do diário) → "scale_budget" (+15% a +20%).
- [qualquer] Custo por resultado (cpa_brl) inflando (>30% vs base) com resultados caindo → "reduce_budget" (-15% a -20%).
- [qualquer] Custo por resultado baixo e ESTÁVEL + orçamento batendo o teto → "scale_budget" (+15% a +20%), mesmo sem ROAS (vale pra messages/engagement/leads).
- [qualquer] Gasto subiu mas resultados não acompanharam (escala ineficiente) → "reduce_budget".
- [qualquer] avg_frequency alta (>3-4) e CTR caindo → fadiga → nota de renovar criativo no rationale (use "pause" só se desperdício grande, conv/result ~0 com gasto alto).
- [qualquer] Campanha com gasto relevante e ZERO resultado há vários dias → "pause" (confidence alta só se o gasto for material).
- Campanha pausada que historicamente performava bem e o contexto melhorou → "activate" (raro, confidence moderada).

# REGRAS DE ORÇAMENTO
- Para "scale_budget"/"reduce_budget", devolva "after_budget_brl" = novo orçamento (diário ou total, o MESMO tipo do atual), respeitando o teto de ±20% do atual.
- Para "pause"/"activate" NÃO mande orçamento.
- Para "reallocate", mande "reallocate_to_external_id" (campanha destino) e "after_budget_brl" (novo orçamento da campanha de ORIGEM, reduzido).

# FORMATO DE SAÍDA (JSON puro, nada além disto)
{
  "decisions": [
    {
      "entity_external_id": "<id da campanha no dossiê>",
      "type": "scale_budget | reduce_budget | pause | activate | adjust_bid | reallocate",
      "confidence": 0.0-1.0,
      "rationale": "1-2 frases em PT-BR citando o número que disparou",
      "signals": { "roas": 0.8, "cpa_brl": 45.0, "trend": "declining", "daily_spend_brl": 50.0 },
      "after_budget_brl": 60.0,
      "reallocate_to_external_id": "<id destino, só pra reallocate>"
    }
  ]
}

Se NENHUMA campanha justifica ação (dados insuficientes, tudo saudável, ou só ruído), devolva {"decisions": []}. Não invente ação pra preencher.`;

/**
 * Bloco de conhecimento (RAG). No MVP-2 a KB está vazia → string vazia.
 * MVP-3 injeta padrões aprendidos aqui, com prioridade sobre as heurísticas.
 */
export function knowledgeBlock(patterns: string[]): string {
  if (patterns.length === 0) return '';
  return `\n\n# CONHECIMENTO APRENDIDO (tem PRIORIDADE sobre as heurísticas acima)\n${patterns
    .map((p, i) => `${i + 1}. ${p}`)
    .join('\n')}`;
}
