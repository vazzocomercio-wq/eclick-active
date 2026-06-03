import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { LlmService } from '../../../common/llm/llm.service';
import type { AnalyzePatternsDto, TrendItem, TrendPattern } from './trends.types';

const RE_SYSTEM = `Você é um analista de conteúdo viral. Recebe uma lista de posts/vídeos que
performaram BEM no nicho (engenharia reversa) e decompõe CADA padrão recorrente em peças
reutilizáveis. O objetivo NÃO é copiar, é extrair a ESTRUTURA que fez performar para um
roteirista adaptar à marca. Seja concreto e acionável. O algoritmo recompensa performance,
não originalidade — então capture o que se repete nos vencedores. Responda só JSON válido.`;

interface PatternDraft {
  hook?: string;
  hook_type?: string;
  format?: string;
  structure?: string;
  cta?: string;
  sound?: string;
  scenario?: string;
  why_it_works?: string;
  example_caption?: string;
  category?: string;
}

/**
 * Pilar 2 — Engenharia Reversa. Pega os itens vencedores (preferindo os
 * minerados de PERFIS curados) e decompõe em PADRÕES (hook/formato/CTA/cenário/
 * por que funciona). Esses padrões alimentam o roteirista via
 * buildExemplarContext — "modele a ESTRUTURA, não copie o conteúdo".
 * Agnóstico de rede: opera sobre trend_items de qualquer origem.
 */
@Injectable()
export class ReverseEngineerService {
  private readonly log = new Logger(ReverseEngineerService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
  ) {}

  // ─── Seleção dos vencedores ─────────────────────────────────────
  private async pickWinners(
    orgId: string,
    dto: AnalyzePatternsDto,
  ): Promise<TrendItem[]> {
    const limit = Math.min(dto.limit ?? 15, 40);
    const build = (profileOnly: boolean) => {
      let q = this.supabase.adminClient
        .from('trend_items')
        .select('*')
        .eq('org_id', orgId)
        .order('score', { ascending: false })
        .order('collected_at', { ascending: false })
        .limit(limit);
      if (profileOnly) q = q.eq('origin', 'profile');
      if (dto.category) q = q.eq('category', dto.category);
      if (dto.network) q = q.eq('source', dto.network);
      return q;
    };
    // prioriza posts de perfis curados; completa com o resto se faltar
    const { data: prof, error: e1 } = await build(true);
    if (e1) throw e1;
    let items = (prof ?? []) as TrendItem[];
    if (items.length < Math.min(5, limit)) {
      const { data: any, error: e2 } = await build(false);
      if (e2) throw e2;
      const seen = new Set(items.map((i) => i.id));
      for (const it of (any ?? []) as TrendItem[]) {
        if (!seen.has(it.id)) items.push(it);
      }
      items = items.slice(0, limit);
    }
    return items;
  }

  // ─── Decomposição (1 chamada LLM) ───────────────────────────────
  async analyze(
    orgId: string,
    dto: AnalyzePatternsDto = {},
  ): Promise<{ patterns: number }> {
    const items = await this.pickWinners(orgId, dto);
    if (!items.length) return { patterns: 0 };

    const itemsText = items
      .map((i, idx) => {
        const m = i.metrics ?? {};
        const stats = [
          m.views ? `${m.views} views` : '',
          m.likes ? `${m.likes} likes` : '',
          m.comments ? `${m.comments} comentários` : '',
          m.shares ? `${m.shares} shares` : '',
        ]
          .filter(Boolean)
          .join(', ');
        return [
          `${idx + 1}. [${i.source}/${i.kind}] @${i.author_handle ?? '?'} ${stats ? `(${stats})` : ''} score ${i.score}`,
          i.title ? `   título: ${i.title.slice(0, 120)}` : '',
          i.description ? `   legenda: ${i.description.slice(0, 300)}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n');

    const user = [
      'Estes são os posts/vídeos que MAIS performaram no nicho (vindos de perfis de referência e tendências):',
      '',
      itemsText,
      '',
      'Extraia de 4 a 6 PADRÕES VENCEDORES recorrentes. Seja CONCISO — no máximo 1 frase por campo. Para cada padrão, preencha:',
      '- hook: um gancho de abertura no MESMO espírito (adaptável, em PT-BR)',
      '- hook_type: tipo do gancho (ex: quebra_de_padrão, verdade_oculta, alerta, transformação, lista)',
      '- format: formato do vídeo (ex: "talking-head 15s", "antes/depois", "demonstração", "listicle")',
      '- structure: a estrutura narrativa (ex: "Dor → Solução → Prova → CTA")',
      '- cta: a chamada para ação típica',
      '- sound: tipo de som/trilha quando relevante (ou null)',
      '- scenario: cenário/ambientação típica',
      '- why_it_works: por que ISSO performou (o insight psicológico/algorítmico)',
      '- example_caption: um exemplo curto de legenda no estilo (PT-BR)',
      '',
      'JSON: {"patterns":[{"hook":"...","hook_type":"...","format":"...","structure":"...","cta":"...","sound":"...","scenario":"...","why_it_works":"...","example_caption":"..."}]}',
    ].join('\n');

    let drafts: PatternDraft[] = [];
    let cost = 0;
    try {
      const r = await this.llm.chat({
        orgId,
        feature: 'social_reverse_engineer',
        system: RE_SYSTEM,
        user,
        json_mode: true,
        max_tokens: 4096,
        temperature: 0.6,
      });
      cost = (r as { cost_usd?: number }).cost_usd ?? 0;
      const clean = r.text.replace(/```json/gi, '').replace(/```/g, '').trim();
      try {
        const parsed = JSON.parse(clean) as { patterns?: PatternDraft[] };
        drafts = (parsed.patterns ?? []).slice(0, 6);
      } catch {
        // resposta truncada (max_tokens) → salva os objetos completos
        drafts = salvageObjects(clean).slice(0, 6);
        if (drafts.length) {
          this.log.warn(`analyze: JSON truncado, recuperados ${drafts.length} padrões`);
        }
      }
    } catch (e) {
      this.log.warn(`analyze LLM falhou: ${(e as Error).message}`);
      return { patterns: 0 };
    }
    if (!drafts.length) return { patterns: 0 };

    // desativa padrões antigos do mesmo escopo (mantém histórico, sai do feed)
    let deact = this.supabase.adminClient
      .from('trend_patterns')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('is_active', true);
    if (dto.category) deact = deact.eq('category', dto.category);
    if (dto.brand_id) deact = deact.eq('brand_id', dto.brand_id);
    await deact;

    const srcIds = items.map((i) => i.id);
    const perCost = cost / drafts.length;
    const rows = drafts.map((d) => ({
      org_id: orgId,
      brand_id: dto.brand_id ?? null,
      category: (dto.category ?? d.category ?? null) || null,
      network: dto.network ?? null,
      source_item_ids: srcIds,
      hook: str(d.hook, 400),
      hook_type: str(d.hook_type, 60),
      format: str(d.format, 120),
      structure: str(d.structure, 300),
      cta: str(d.cta, 200),
      sound: str(d.sound, 120),
      scenario: str(d.scenario, 300),
      why_it_works: str(d.why_it_works, 600),
      example_caption: str(d.example_caption, 600),
      score: items[0]?.score ?? 0,
      cost_usd: perCost,
    }));

    const { error } = await this.supabase.adminClient.from('trend_patterns').insert(rows);
    if (error) {
      this.log.warn(`analyze insert falhou: ${(error as Error).message}`);
      return { patterns: 0 };
    }
    return { patterns: rows.length };
  }

  // ─── Leitura ────────────────────────────────────────────────────
  async list(orgId: string, category?: string, limit = 30): Promise<TrendPattern[]> {
    let q = this.supabase.adminClient
      .from('trend_patterns')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 100));
    if (category) q = q.eq('category', category);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as TrendPattern[];
  }

  async countActive(orgId: string): Promise<number> {
    const { count, error } = await this.supabase.adminClient
      .from('trend_patterns')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_active', true);
    if (error) return 0;
    return count ?? 0;
  }

  /**
   * Bloco de texto p/ injetar no roteirista (planAngles / REEL_SCRIPT):
   * os padrões vencedores do nicho. Vazio se não houver padrões.
   */
  async buildExemplarContext(
    orgId: string,
    opts: { category?: string; limit?: number } = {},
  ): Promise<string> {
    const patterns = await this.list(orgId, opts.category, opts.limit ?? 6);
    if (!patterns.length) return '';
    const lines = patterns.map((p, idx) => {
      const parts = [
        `${idx + 1}. GANCHO (${p.hook_type ?? 'n/a'}): ${p.hook ?? ''}`,
        p.format ? `   formato: ${p.format}` : '',
        p.structure ? `   estrutura: ${p.structure}` : '',
        p.cta ? `   CTA: ${p.cta}` : '',
        p.why_it_works ? `   por que funciona: ${p.why_it_works}` : '',
      ].filter(Boolean);
      return parts.join('\n');
    });
    return [
      'PADRÕES VENCEDORES DO NICHO (engenharia reversa de perfis de referência — modele a ESTRUTURA, NÃO copie o conteúdo):',
      ...lines,
    ].join('\n');
  }
}

function str(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'null') return null;
  return s.slice(0, max);
}

/**
 * Recupera objetos-padrão de um JSON possivelmente truncado (max_tokens):
 * varre os blocos { } balanceados (ignorando chaves dentro de strings) e
 * parseia cada um isoladamente. O objeto externo truncado nunca fecha, então
 * só os padrões completos são recuperados.
 */
function salvageObjects(text: string): PatternDraft[] {
  const out: PatternDraft[] = [];
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
          const obj = JSON.parse(text.slice(s, i + 1)) as PatternDraft;
          if (obj && (obj.hook || obj.format || obj.hook_type || obj.why_it_works)) {
            out.push(obj);
          }
        } catch {
          /* objeto incompleto/aninhado inválido — ignora */
        }
      }
    }
  }
  return out;
}
