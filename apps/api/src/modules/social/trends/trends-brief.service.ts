import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { LlmService } from '../../../common/llm/llm.service';
import { BridgeService } from '../../bridge/bridge.service';
import type { CampaignCandidate, OrganicSummary } from '../../bridge/bridge.types';
import { TrendsService } from './trends.service';
import type { TrendItem, TrendNetwork } from './trends.types';

const BRIEF_SYSTEM = `Você é o estrategista de CRESCIMENTO ORGÂNICO da marca no e-Click. O método é claro:
o algoritmo recompensa PERFORMANCE, não originalidade. Não se reinventa — MODELA-SE quem já
performa no nicho (os vencedores coletados) e adapta-se à nossa marca para CRESCER a audiência.

REGRAS INEGOCIÁVEIS:
1. ESCREVA SEMPRE EM PORTUGUÊS DO BRASIL — título, gancho, roteiro, CTA, hashtags, TUDO.
   As tendências de referência podem estar em inglês: TRADUZA e ADAPTE a ideia para o público
   brasileiro. NUNCA devolva qualquer texto em inglês (exceto nomes próprios/marcas/siglas).
2. O foco é CONTEÚDO DE VALOR E AUTORIDADE que cresce o público. Modele o GANCHO, o FORMATO e a
   ESTRUTURA dos vencedores. NÃO é enfiar produto em todo post.
3. PRODUTO É OPCIONAL: só sugira um produto se ele for do MESMO nicho/assunto da tendência. Se a
   tendência é de um tema (ex.: marketing/IA) e os produtos da loja são de outro (ex.: iluminação),
   NÃO force o produto — deixe suggested_products vazio e entregue conteúdo puro de autoridade.
   Forçar produto sem encaixe destrói o crescimento orgânico.

Seja concreto, no tom da marca, nada genérico. Responda só JSON válido.`;

interface BriefDraft {
  title?: string;
  category?: string;
  format?: string;
  hook?: string;
  script?: string;
  visual_style?: string;
  suggested_products?: string[];
  hashtags?: string[];
  cta?: string;
  rationale?: string;
}

/**
 * TR-3 — motor de inteligência do Radar de Conteúdo. Transforma os dados crus
 * (trend_items de YouTube/Google Trends) + engajamento próprio (bridge) +
 * oportunidade comercial (bridge: margem/estoque/Radar) em:
 *   - trend_signals: leituras determinísticas (formato/tópico/busca em alta)
 *   - trend_briefs: pautas acionáveis geradas por IA (1 chamada LLM)
 */
@Injectable()
export class TrendsBriefService {
  private readonly log = new Logger(TrendsBriefService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
    private readonly bridge: BridgeService,
    private readonly trends: TrendsService,
  ) {}

  /**
   * Gera sinais + pautas. Quando `category` é passado, ESCOPA tudo (itens,
   * sinais e pautas) àquela categoria — os sinais/pautas das outras categorias
   * ficam intactos. Sem categoria, regenera o panorama inteiro.
   */
  async generate(
    orgId: string,
    category?: string,
  ): Promise<{ signals: number; briefs: number }> {
    const cat = category?.trim() || undefined;
    const [items, organic, candidates, monitors] = await Promise.all([
      this.trends.listItems(orgId, { category: cat, limit: 40 }),
      this.bridge.getOrganicSummary(orgId).catch(() => null),
      this.bridge.getCampaignCandidates(orgId, 'mixed', 8).catch(() => []),
      this.trends.listMonitors(orgId).catch(() => []),
    ]);

    if (!items.length && !candidates.length) {
      return { signals: 0, briefs: 0 };
    }

    // Rede(s) de DESTINO da pauta: o que o usuário monitora nesta categoria é o
    // que ele quer PRODUZIR. Categoria de YouTube → pauta é roteiro de YouTube,
    // não reel/post de Instagram. Fallback: as fontes dos próprios itens.
    const scoped = monitors.filter(
      (m) => m.is_active && (!cat || m.category === cat),
    );
    let networks = [...new Set(scoped.map((m) => m.network))];
    if (!networks.length) {
      networks = [...new Set(items.map((i) => i.source as TrendNetwork))];
    }

    const signals = await this.buildSignals(orgId, items, cat);
    const briefs = await this.buildBriefs(orgId, items, organic, candidates, cat, networks);
    return { signals, briefs };
  }

  // ─── Sinais determinísticos (sem custo de IA) ───────────────────
  private async buildSignals(
    orgId: string,
    items: TrendItem[],
    scopedCategory?: string,
  ): Promise<number> {
    // snapshot fresco: limpa os não-descartados e re-insere. Se escopado a uma
    // categoria, só mexe nos sinais DELA (preserva as outras).
    let del = this.supabase.adminClient
      .from('trend_signals')
      .delete()
      .eq('org_id', orgId)
      .is('dismissed_at', null);
    if (scopedCategory) del = del.eq('category', scopedCategory);
    await del;

    if (!items.length) return 0;

    const byCat = new Map<string, TrendItem[]>();
    for (const it of items) {
      const c = it.category ?? 'geral';
      const arr = byCat.get(c);
      if (arr) arr.push(it);
      else byCat.set(c, [it]);
    }

    const rows: Array<Record<string, unknown>> = [];
    for (const [cat, list] of byCat) {
      const yt = list.filter((i) => i.source === 'youtube');
      const shorts = yt.filter((i) => i.kind === 'short');

      // formato em alta: shorts dominam?
      if (yt.length >= 3) {
        const shortShare = shorts.length / yt.length;
        if (shortShare >= 0.5) {
          rows.push({
            org_id: orgId,
            source: 'youtube',
            category: cat,
            signal_type: 'format_rising',
            title: `Vídeo curto (Reels/Shorts) dominando em ${cat}`,
            summary: `${Math.round(shortShare * 100)}% dos vídeos em alta em "${cat}" são curtos verticais. Priorize Reels.`,
            score: Math.round(shortShare * 100),
            evidence_item_ids: shorts.slice(0, 5).map((i) => i.id),
          });
        }
      }

      // buscas em ascensão (Google Trends)
      const queries = list.filter((i) => i.source === 'google_trends').slice(0, 3);
      for (const q of queries) {
        rows.push({
          org_id: orgId,
          source: 'google_trends',
          category: cat,
          signal_type: 'search_spike',
          title: `"${q.title}" subindo nas buscas`,
          summary: `Termo em ascensão no Google Trends para "${cat}".`,
          score: q.score,
          evidence_item_ids: [q.id],
        });
      }

      // tópico em alta: top vídeo da categoria.
      // Título do signal SEMPRE em PT-BR (template) pra não vazar título raw
      // do YouTube em inglês no digest do WhatsApp/Slack. O título original
      // fica acessível pelo evidence_item_ids → trend_items na tela do Radar.
      const topVid = yt[0];
      if (topVid) {
        const views = Number(topVid.metrics.views ?? 0);
        const viewsLabel =
          views >= 1_000_000
            ? `${(views / 1_000_000).toFixed(1).replace('.', ',')} mi de views`
            : views >= 1_000
              ? `${Math.round(views / 1000)} mil views`
              : `${views} views`;
        rows.push({
          org_id: orgId,
          source: 'youtube',
          category: cat,
          signal_type: 'topic_rising',
          title: `Vídeo em alta em ${cat} · ${viewsLabel}`.slice(0, 80),
          summary: `Vídeo bombando em "${cat}" com ${viewsLabel}. Abra o Radar pra ver o exemplo.`,
          score: topVid.score,
          evidence_item_ids: [topVid.id],
        });
      }

      // ── Instagram / TikTok (perfis + hashtag): sinais próprios ──
      // Antes os sinais só vinham de YouTube/Google Trends; nichos só-social
      // ficavam sem leitura. Agora IG/TikTok geram formato + tópico em alta.
      const social = list
        .filter((i) => i.source === 'instagram' || i.source === 'tiktok')
        .sort((a, b) => b.score - a.score);
      if (social.length >= 3) {
        const videos = social.filter(
          (i) => i.kind === 'video' || i.kind === 'short' || i.media_type === 'video',
        );
        const videoShare = videos.length / social.length;
        if (videoShare >= 0.5) {
          rows.push({
            org_id: orgId,
            source: videos[0]?.source ?? 'instagram',
            category: cat,
            signal_type: 'format_rising',
            title: `Reels/vídeo curto dominando em ${cat}`,
            summary: `${Math.round(videoShare * 100)}% do que performa em "${cat}" no IG/TikTok é vídeo vertical. Priorize Reels.`,
            score: Math.round(videoShare * 100),
            evidence_item_ids: videos.slice(0, 5).map((i) => i.id),
          });
        }

        const top = social[0];
        const eng = Number(top.metrics.views ?? top.metrics.likes ?? 0);
        const engLabel =
          eng >= 1_000_000
            ? `${(eng / 1_000_000).toFixed(1).replace('.', ',')} mi`
            : eng >= 1_000
              ? `${Math.round(eng / 1000)} mil`
              : `${eng}`;
        const unit = top.metrics.views != null ? 'views' : 'likes';
        rows.push({
          org_id: orgId,
          source: top.source,
          category: cat,
          signal_type: 'topic_rising',
          title: `Conteúdo em alta em ${cat} · ${engLabel} ${unit}`.slice(0, 80),
          summary: `Post de @${top.author_handle ?? '?'} bombando em "${cat}" (${engLabel} ${unit}). Abra o Radar pra modelar.`,
          score: top.score,
          evidence_item_ids: [top.id],
        });
      }
    }

    if (!rows.length) return 0;
    const { error } = await this.supabase.adminClient.from('trend_signals').insert(rows);
    if (error) {
      this.log.warn(`buildSignals falhou: ${(error as Error).message}`);
      return 0;
    }
    return rows.length;
  }

  // ─── Briefs por IA (1 chamada LLM) ──────────────────────────────
  private async buildBriefs(
    orgId: string,
    items: TrendItem[],
    organic: OrganicSummary | null,
    candidates: CampaignCandidate[],
    scopedCategory?: string,
    networks: TrendNetwork[] = [],
  ): Promise<number> {
    const fmt = formatGuidance(networks);
    const trendText = items.length
      ? items
          .slice(0, 15)
          .map(
            (i, idx) =>
              `${idx + 1}. [${i.source}/${i.kind}] "${(i.title ?? '').slice(0, 70)}"` +
              `${i.metrics.views ? ` (${i.metrics.views} views)` : ''} score ${i.score}`,
          )
          .join('\n')
      : '(sem tendências coletadas)';
    const risingText =
      items
        .filter((i) => i.source === 'google_trends')
        .slice(0, 8)
        .map((i) => i.title)
        .filter(Boolean)
        .join(', ') || '(sem buscas em alta)';
    const candText = candidates.length
      ? candidates
          .map(
            (c, idx) =>
              `${idx + 1}. ${c.product_name} | margem ${c.margin_pct ?? '?'}% | estoque ${c.stock}` +
              `${c.is_overstock ? ' (OVERSTOCK)' : ''} | demanda ${c.demand_trend}`,
          )
          .join('\n')
      : '(sem produtos cadastrados)';
    const fmtHint = organic?.best_format ? `Formato que mais engaja: ${organic.best_format}. ` : '';
    const hourHint = organic?.best_hour != null ? `Melhor horário ~${organic.best_hour}h.` : '';

    // Padrões vencedores (engenharia reversa) — o MOLDE do método. Best-effort:
    // se ainda não rodaram "Analisar", vem vazio e modelamos direto dos itens.
    const patternsText = await this.fetchPatternsText(orgId, scopedCategory);

    const user = [
      'Gere PAUTAS de CRESCIMENTO ORGÂNICO: modele os vencedores do nicho e adapte à nossa marca.',
      'TODAS as pautas DEVEM ser escritas em PORTUGUÊS DO BRASIL — mesmo que as referências estejam em inglês, traduza e adapte a ideia.',
      scopedCategory
        ? `FOCO: gere TODAS as pautas para a categoria/nicho "${scopedCategory}". Use o campo category="${scopedCategory}".`
        : '',
      '',
      `PLATAFORMA DE DESTINO: ${fmt.instruction}`,
      '',
      'CONTEÚDO VENCEDOR DO NICHO (modele o GANCHO, FORMATO e ESTRUTURA destes — NÃO copie literal, adapte ao nosso público em PT-BR):',
      trendText,
      '',
      'PADRÕES VENCEDORES JÁ EXTRAÍDOS (engenharia reversa — use como molde de gancho/estrutura/CTA):',
      patternsText,
      '',
      `BUSCAS EM ASCENSÃO: ${risingText}`,
      '',
      `NOSSO ENGAJAMENTO: ${fmtHint}${hourHint}`,
      '',
      'PRODUTO DA LOJA (OPCIONAL — só inclua em suggested_products se o produto for do MESMO nicho/assunto da tendência; se não houver encaixe natural, deixe suggested_products = [] e faça conteúdo puro de autoridade que cresce o público):',
      candText,
      '',
      'Gere EXATAMENTE 4 pautas, TODAS em português do Brasil. JSON:',
      `{"briefs":[{"title":"<em PT-BR>","category":"...","format":"${fmt.enumHint}","hook":"<gancho em PT-BR, modelado num vencedor>","script":"<roteiro em PT-BR no formato da plataforma de destino>","visual_style":"<estilo visual>","suggested_products":["<só se houver encaixe real de nicho; senão deixe a lista vazia>"],"hashtags":["#..."],"cta":"<em PT-BR>","rationale":"<por que ESTE gancho/formato modela um vencedor e CRESCE a audiência — cite o trend de referência; mencione produto só se houver encaixe real>"}]}`,
    ].join('\n');

    let drafts: BriefDraft[] = [];
    let cost = 0;
    try {
      const r = await this.llm.chat({
        orgId,
        feature: 'social_intelligence_today',
        system: BRIEF_SYSTEM,
        user,
        json_mode: true,
        max_tokens: 4096,
        temperature: 0.7,
      });
      cost = (r as { cost_usd?: number }).cost_usd ?? 0;
      const clean = r.text.replace(/```json/gi, '').replace(/```/g, '').trim();
      try {
        const parsed = JSON.parse(clean) as { briefs?: BriefDraft[] };
        drafts = (parsed.briefs ?? []).slice(0, 6);
      } catch {
        // resposta truncada (max_tokens) → recupera os objetos completos
        drafts = salvageBriefs(clean).slice(0, 6);
        if (drafts.length) {
          this.log.warn(`buildBriefs: JSON truncado, recuperadas ${drafts.length} pautas`);
        }
      }
    } catch (e) {
      this.log.warn(`buildBriefs LLM falhou: ${(e as Error).message}`);
      return 0;
    }
    if (!drafts.length) return 0;

    // regenera: limpa drafts antigos (mantém used/dismissed). Se escopado a
    // uma categoria, só apaga os drafts DELA (preserva as outras categorias).
    let delDraft = this.supabase.adminClient
      .from('trend_briefs')
      .delete()
      .eq('org_id', orgId)
      .eq('status', 'draft');
    if (scopedCategory) delDraft = delDraft.eq('category', scopedCategory);
    await delDraft;

    const perCost = cost / drafts.length;
    const rows = drafts.map((b) => {
      const format = fmt.allowed.includes(String(b.format))
        ? String(b.format)
        : fmt.allowed[0];
      const suggested = (Array.isArray(b.suggested_products) ? b.suggested_products : [])
        .slice(0, 4)
        .map((name) => {
          const n = String(name);
          const cand = candidates.find(
            (c) =>
              (c.product_name ?? '').toLowerCase().includes(n.toLowerCase()) ||
              n.toLowerCase().includes((c.product_name ?? '').toLowerCase()),
          );
          return {
            name: n.slice(0, 120),
            product_id: cand?.product_id ?? null,
            photo_url: cand?.product_photo_url ?? null,
          };
        });
      return {
        org_id: orgId,
        category: (scopedCategory ?? String(b.category ?? '')).slice(0, 80) || null,
        title: String(b.title ?? '').slice(0, 160),
        format,
        hook: String(b.hook ?? '').slice(0, 300) || null,
        script: String(b.script ?? '').slice(0, 2000) || null,
        visual_style: String(b.visual_style ?? '').slice(0, 300) || null,
        suggested_products: suggested,
        hashtags: (Array.isArray(b.hashtags) ? b.hashtags : [])
          .slice(0, 15)
          .map((h) => String(h).slice(0, 40)),
        cta: String(b.cta ?? '').slice(0, 200) || null,
        rationale: String(b.rationale ?? '').slice(0, 500) || null,
        status: 'draft',
        cost_usd: perCost,
      };
    });

    const { error } = await this.supabase.adminClient.from('trend_briefs').insert(rows);
    if (error) {
      this.log.warn(`buildBriefs insert falhou: ${(error as Error).message}`);
      return 0;
    }
    return rows.length;
  }

  /**
   * Busca os padrões vencedores (engenharia reversa, trend_patterns) pra usar
   * como molde na geração das pautas — o coração do método. Best-effort: se
   * ainda não rodaram "Analisar", devolve placeholder e modelamos pelos itens.
   */
  private async fetchPatternsText(orgId: string, scopedCategory?: string): Promise<string> {
    try {
      let q = this.supabase.adminClient
        .from('trend_patterns')
        .select('hook, hook_type, format, structure, cta, why_it_works, score')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('score', { ascending: false })
        .limit(6);
      if (scopedCategory) q = q.eq('category', scopedCategory);
      const { data } = await q;
      const rows = (data ?? []) as Array<{
        hook?: string; hook_type?: string; format?: string;
        structure?: string; cta?: string; why_it_works?: string;
      }>;
      if (!rows.length) {
        return '(sem padrões extraídos ainda — modele diretamente do conteúdo vencedor acima)';
      }
      return rows
        .map(
          (p, i) =>
            `${i + 1}. Gancho [${p.hook_type ?? '?'}]: "${(p.hook ?? '').slice(0, 90)}" | ` +
            `formato ${p.format ?? '?'} | estrutura: ${(p.structure ?? '').slice(0, 90)} | ` +
            `CTA: ${(p.cta ?? '').slice(0, 60)} | por que funciona: ${(p.why_it_works ?? '').slice(0, 90)}`,
        )
        .join('\n');
    } catch {
      return '(sem padrões extraídos ainda — modele diretamente do conteúdo vencedor acima)';
    }
  }

  /** Descarta um brief (não some, só sai do feed ativo). */
  async dismissBrief(orgId: string, id: string): Promise<void> {
    await this.supabase.adminClient
      .from('trend_briefs')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', orgId);
  }
}

/**
 * Define os formatos de pauta e a instrução de roteiro conforme a(s) rede(s) de
 * DESTINO da categoria. O usuário PRODUZ para onde ele monitora: categoria de
 * YouTube → roteiro de vídeo de YouTube (longo ou Short), não reel/post/carrossel.
 */
function formatGuidance(networks: TrendNetwork[]): {
  allowed: string[];
  instruction: string;
  enumHint: string;
} {
  const set = new Set(networks);
  const hasYoutube = set.has('youtube');
  const hasSocial = set.has('instagram') || set.has('tiktok') || set.has('meta_ads');

  if (hasYoutube && !hasSocial) {
    return {
      allowed: ['youtube', 'youtube_short'],
      instruction:
        'Estas pautas são para o YOUTUBE. Cada pauta é um ROTEIRO DE VÍDEO de YouTube — ' +
        'use "youtube" para vídeo longo (5-12 min: gancho nos primeiros segundos, ' +
        'desenvolvimento em blocos, CTA de inscrição) ou "youtube_short" para Shorts vertical ' +
        '(30-60s, gancho imediato, ritmo rápido). O campo script deve ser um roteiro de ' +
        'narração/cena de YouTube (fala + corte), NÃO uma legenda de post.',
      enumHint: 'youtube|youtube_short',
    };
  }
  if (hasYoutube && hasSocial) {
    return {
      allowed: ['youtube', 'youtube_short', 'reel', 'post', 'carousel'],
      instruction:
        'Gere pautas no formato NATIVO da plataforma de cada tendência: roteiro de YouTube ' +
        '(youtube / youtube_short) para tendências de YouTube; reel/post/carousel para ' +
        'Instagram/TikTok. O campo script deve respeitar o formato escolhido.',
      enumHint: 'youtube|youtube_short|reel|post|carousel',
    };
  }
  return {
    allowed: ['reel', 'post', 'carousel'],
    instruction:
      'Gere pautas no formato nativo de Reels/Instagram/TikTok (reel/post/carousel). ' +
      'O campo script deve ser o roteiro/copy do formato escolhido.',
    enumHint: 'reel|post|carousel',
  };
}

/**
 * Recupera pautas de um JSON possivelmente truncado (max_tokens): varre os
 * blocos { } balanceados (ignorando chaves dentro de strings) e parseia cada
 * um. O objeto externo truncado nunca fecha, então só as pautas completas saem.
 */
function salvageBriefs(text: string): BriefDraft[] {
  const out: BriefDraft[] = [];
  const stack: number[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push(i);
    else if (ch === '}') {
      const s = stack.pop();
      if (s != null) {
        try {
          const obj = JSON.parse(text.slice(s, i + 1)) as BriefDraft;
          if (obj && (obj.title || obj.hook || obj.script)) out.push(obj);
        } catch {
          /* objeto incompleto/aninhado — ignora */
        }
      }
    }
  }
  return out;
}
