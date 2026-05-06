import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../common/llm/llm.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  KB,
  matchKbEntries,
  listKbByCategory as kbListByCategory,
  type KbEntry,
} from './copilot.kb';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface HelpInput {
  orgId: string;
  userId?: string;
  pathname: string;
  question: string;
  history?: ChatTurn[];
}

interface HelpResult {
  answer: string;
  matched_kb: number;
  cost_usd: number;
}

interface FeedbackInput {
  orgId: string;
  userId?: string;
  pathname: string;
  question: string;
  answer: string;
  rating: 'up' | 'down';
  comment?: string;
}

const MAX_KB_CONTEXT_CHARS = 3000;
const MAX_HISTORY_TURNS = 6; // 3 pares user/assistant

const SYSTEM_PROMPT = [
  'Você é o **Copiloto IA do e-Click Active** — um CRM de WhatsApp + automações + atendimento.',
  '',
  'Foco da sua ajuda:',
  '- Caixa unificada de conversas (inbox), WhatsApp/Baileys, automações visuais,',
  '  contatos, deals/funis, base de conhecimento, intelligence hub, commerce.',
  '',
  'Tom: amigável-direto, PT-BR, sem floreio.',
  '',
  'Regras de resposta:',
  '1. Use **markdown** (negrito, listas, code inline). Sem H1/H2 — use negrito pra títulos.',
  '2. Seja conciso — máx ~6 parágrafos curtos ou 8 bullets.',
  '3. Se a pergunta for vaga, peça clarificação curta.',
  '4. Se não souber, diga "Não tenho info confiável sobre isso aqui no Copiloto" — não invente caminhos.',
  '5. Quando referenciar uma tela, use o path real (ex: `/automacoes`, `/configuracoes/canais`).',
  '6. Quando relevante, mencione atalho `Cmd/Ctrl + K` pra reabrir o copiloto.',
].join('\n');

/**
 * Service do Copiloto Flutuante v1.
 *
 * Responsabilidades:
 * - Bater no `LlmService` com KB filtrada por rota como contexto.
 * - Expor KB inteira agrupada (fallback "ver tudo" no UI).
 * - Logar feedback do usuário em `active.ai_interactions` (metadata).
 *
 * IMPORTANTE: separado do `CopilotService` (que faz tool-use). Aqui é só
 * help estático + LLM contextual — feature simples, sem side effects.
 */
@Injectable()
export class CopilotHelpService {
  private readonly logger = new Logger(CopilotHelpService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Retorna entries da KB que casam com o pathname atual + total da KB.
   * Usado pelo frontend pra renderizar chips contextuais e exibir "X tópicos".
   */
  getRouteContext(pathname: string): {
    entries: KbEntry[];
    total_kb_size: number;
  } {
    const entries = matchKbEntries(pathname);
    return { entries, total_kb_size: KB.length };
  }

  /**
   * Pergunta livre. Constrói contexto a partir das entries que casam com a
   * rota (limitado a MAX_KB_CONTEXT_CHARS) + últimos MAX_HISTORY_TURNS turnos
   * de conversa.
   */
  async chat(input: HelpInput): Promise<HelpResult> {
    const matched = matchKbEntries(input.pathname);
    const kbExcerpt = this.buildKbContext(matched);

    const userPrompt = this.buildUserPrompt({
      pathname: input.pathname,
      question: input.question,
      kbExcerpt,
    });

    // Mensagens: turnos anteriores (se houver) + a pergunta atual
    const history = (input.history ?? [])
      .slice(-MAX_HISTORY_TURNS)
      .map((t) => ({ role: t.role, content: t.content }));

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...history,
      { role: 'user', content: userPrompt },
    ];

    const out = await this.llm.chat({
      orgId: input.orgId,
      feature: 'copilot_help',
      system: SYSTEM_PROMPT,
      user: messages,
      max_tokens: 600,
      temperature: 0.3,
      ...(input.userId ? { context: { user_id: input.userId } } : {}),
      metadata: {
        copilot: 'help_v1',
        pathname: input.pathname,
        matched_kb_titles: matched.map((e) => e.title),
      },
    });

    return {
      answer: out.text.trim(),
      matched_kb: matched.length,
      cost_usd: out.cost_usd,
    };
  }

  /** KB inteira agrupada por categoria — pra fallback de UI. */
  listKbByCategory(): Record<string, KbEntry[]> {
    return kbListByCategory();
  }

  /**
   * Loga feedback (👍/👎 + comment opcional) em ai_interactions com
   * metadata `{ type: 'copilot_feedback', rating, ... }`.
   * Best-effort — não levanta se DB falhar.
   */
  async recordFeedback(input: FeedbackInput): Promise<void> {
    try {
      const { error } = await this.supabase.adminClient
        .from('ai_interactions')
        .insert({
          org_id: input.orgId,
          interaction_type: 'copilot_help_feedback',
          provider: 'anthropic',
          model: 'feedback',
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
          latency_ms: 0,
          user_id: input.userId ?? null,
          result_summary: `${input.rating} — ${input.question.slice(0, 100)}`,
          metadata: {
            type: 'copilot_feedback',
            rating: input.rating,
            pathname: input.pathname,
            question: input.question.slice(0, 500),
            answer: input.answer.slice(0, 1500),
            comment: input.comment?.slice(0, 500) ?? null,
          },
        });
      if (error) {
        this.logger.warn(`recordFeedback falhou: ${error.message}`);
      }
    } catch (err) {
      this.logger.warn(
        `recordFeedback caught: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────

  private buildKbContext(entries: KbEntry[]): string {
    let out = '';
    for (const e of entries) {
      const block = `### ${e.title}\n${e.content}\n\n`;
      if (out.length + block.length > MAX_KB_CONTEXT_CHARS) break;
      out += block;
    }
    return out;
  }

  private buildUserPrompt(args: {
    pathname: string;
    question: string;
    kbExcerpt: string;
  }): string {
    const parts: string[] = [];
    parts.push(`**Tela atual:** \`${args.pathname}\``);

    if (args.kbExcerpt) {
      parts.push(
        '**Contexto da KB sobre esta tela:**',
        args.kbExcerpt.trim(),
        '',
      );
    } else {
      parts.push(
        '_Nenhuma entry da KB casa com esta tela — responda com base no que você sabe sobre o Active de modo geral._',
      );
    }

    parts.push('**Pergunta do usuário:**', args.question.trim());
    return parts.join('\n\n');
  }
}
