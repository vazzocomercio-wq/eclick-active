import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../common/llm/llm.service';
import { SupabaseService } from '../../common/supabase/supabase.service';

export interface SignalForMessage {
  id: string;
  signal_type: string;
  severity: 'warning' | 'critical';
  current_value: number | null;
  threshold_value: number | null;
  payload: Record<string, unknown>;
  generated_at: string;
}

export interface FormatResult {
  text: string;
  /** 'llm' quando passou pela Camada 4; 'template' quando caiu no fallback. */
  narrator: 'llm' | 'template';
}

const SEVERITY_EMOJI: Record<'warning' | 'critical', string> = {
  warning: '⚠️',
  critical: '🚨',
};

const SIGNAL_TYPE_LABEL: Record<string, string> = {
  metric_threshold: 'Métrica fora do alvo',
  metric_anomaly: 'Métrica com desvio anômalo',
  creative_fatigue: 'Criativo desgastando',
  audience_burnout: 'Audiência saturada',
  scaling_inefficiency: 'Escala ineficiente',
  pixel_drift: 'Conversões caindo (pixel?)',
};

/**
 * MessageFormatter — Camada 4 (LLM) com fallback determinístico.
 *
 * - Org com cred LLM em org_llm_credentials → tenta LLM. Falha → fallback.
 * - Org sem cred → vai direto pra template cru.
 *
 * Filosofia: nenhum alerta é perdido por falta de LLM. Texto pode ser
 * menos polido mas chega.
 */
@Injectable()
export class AlertMessageFormatter {
  private readonly logger = new Logger(AlertMessageFormatter.name);

  constructor(
    private readonly llm: LlmService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Formata 1 signal individual (delivery_mode='immediate'). Inclui
   * cumprimento personalizado pro manager.
   */
  async formatImmediate(
    orgId: string,
    managerName: string,
    signal: SignalForMessage,
    campaignName: string | null,
  ): Promise<FormatResult> {
    const hasLlm = await this.orgHasLlmCred(orgId);

    const fallback = (): FormatResult => ({
      text: this.templateImmediate(managerName, signal, campaignName),
      narrator: 'template',
    });

    if (!hasLlm) return fallback();

    try {
      const system = `Você escreve alertas curtos e diretos pra gestores de marketing brasileiros via WhatsApp.

Regras:
- Português brasileiro, tom profissional mas próximo (não formal demais)
- Máximo 4-5 linhas
- Comece com cumprimento + nome do gestor
- Inclua emoji de severidade NO INÍCIO (warning=⚠️, critical=🚨)
- Mencione o NOME da campanha quando disponível
- Termine com 1 sugestão acionável (ex: "Revise o criativo", "Pause a campanha", "Cheque o pixel")
- NÃO use markdown excessivo. WhatsApp aceita *negrito* e _itálico_ pontuais.
- NÃO faça preâmbulos do tipo "Espero que esteja bem"`;

      const user = `Gerar alerta pra ${managerName}:

Tipo: ${signal.signal_type} (${SIGNAL_TYPE_LABEL[signal.signal_type] ?? signal.signal_type})
Severidade: ${signal.severity}
Campanha: ${campaignName ?? 'conta inteira'}
Valor atual: ${signal.current_value ?? 'n/a'}
Threshold/baseline: ${signal.threshold_value ?? 'n/a'}
Detalhes: ${JSON.stringify(signal.payload).slice(0, 800)}

Gere a mensagem WhatsApp.`;

      const res = await this.llm.chat({
        orgId,
        feature: 'alert_narrative',
        system,
        user,
        max_tokens: 300,
        metadata: {
          source: 'alert_engine',
          signal_id: signal.id,
          signal_type: signal.signal_type,
        },
      });
      const text = res.text.trim();
      if (!text) return fallback();
      return { text, narrator: 'llm' };
    } catch (err) {
      this.logger.warn(
        `formatImmediate LLM falhou (usando template): ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback();
    }
  }

  /**
   * Formata digest com N signals (delivery_mode='digest_*' ou 'weekly').
   * Sempre tenta LLM se disponível — texto longo se beneficia mais.
   */
  async formatDigest(
    orgId: string,
    managerName: string,
    signals: SignalForMessage[],
    slotLabel: string,
  ): Promise<FormatResult> {
    const hasLlm = await this.orgHasLlmCred(orgId);

    const fallback = (): FormatResult => ({
      text: this.templateDigest(managerName, signals, slotLabel),
      narrator: 'template',
    });

    if (!hasLlm) return fallback();

    try {
      const system = `Você escreve resumos consolidados de alertas pra gestores via WhatsApp.

Regras:
- Português brasileiro, tom profissional próximo
- Comece com cumprimento + nome + slot ("Bom dia Marina, resumo das 8h")
- Agrupe por severidade: 🚨 críticos primeiro, ⚠️ avisos depois
- Pra cada item: 1 linha curta com nome da campanha + métrica + ação sugerida
- Máximo 10-12 linhas no total. Se >10 sinais, resuma os menos críticos
- Termine com convite pra ack ("Responda 'visto' pra arquivar todos")
- Sem markdown excessivo`;

      const user = `Gerar digest pra ${managerName} (slot: ${slotLabel}):

${signals.length} sinal(is) acumulado(s) desde último digest:

${signals
  .map(
    (s, i) =>
      `${i + 1}. ${s.signal_type} | severidade=${s.severity} | payload=${JSON.stringify(s.payload).slice(0, 200)}`,
  )
  .join('\n')}

Gere o resumo WhatsApp.`;

      const res = await this.llm.chat({
        orgId,
        feature: 'alert_digest',
        system,
        user,
        max_tokens: 600,
        metadata: {
          source: 'alert_engine',
          signal_count: signals.length,
          slot: slotLabel,
        },
      });
      const text = res.text.trim();
      if (!text) return fallback();
      return { text, narrator: 'llm' };
    } catch (err) {
      this.logger.warn(
        `formatDigest LLM falhou (usando template): ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback();
    }
  }

  // ────────────────────────────────────────────
  // Templates determinísticos (fallback)
  // ────────────────────────────────────────────

  private templateImmediate(
    managerName: string,
    signal: SignalForMessage,
    campaignName: string | null,
  ): string {
    const firstName = managerName.trim().split(/\s+/)[0] ?? managerName;
    const emoji = SEVERITY_EMOJI[signal.severity];
    const label = SIGNAL_TYPE_LABEL[signal.signal_type] ?? signal.signal_type;
    const campaignTxt = campaignName ? `*${campaignName}*` : 'conta inteira';

    const valueLine = (() => {
      if (signal.current_value === null || signal.threshold_value === null) {
        return '';
      }
      return `\nValor atual: ${signal.current_value} (alvo: ${signal.threshold_value})`;
    })();

    return `${emoji} Olá ${firstName}, alerta novo:

*${label}* em ${campaignTxt}.${valueLine}

Recomendado: revise a campanha em ${signal.severity === 'critical' ? 'urgência' : 'breve'}.`;
  }

  private templateDigest(
    managerName: string,
    signals: SignalForMessage[],
    slotLabel: string,
  ): string {
    const firstName = managerName.trim().split(/\s+/)[0] ?? managerName;
    const critical = signals.filter((s) => s.severity === 'critical');
    const warnings = signals.filter((s) => s.severity === 'warning');

    const lines: string[] = [];
    lines.push(`📋 Olá ${firstName}, resumo (${slotLabel}) — ${signals.length} sinal(is):`);

    if (critical.length > 0) {
      lines.push('');
      lines.push(`🚨 Críticos (${critical.length}):`);
      for (const s of critical.slice(0, 5)) {
        const label = SIGNAL_TYPE_LABEL[s.signal_type] ?? s.signal_type;
        const camp = (s.payload?.campaign_name as string | undefined) ?? '';
        lines.push(`• ${label}${camp ? ` — ${camp}` : ''}`);
      }
      if (critical.length > 5) lines.push(`• ...e mais ${critical.length - 5}`);
    }

    if (warnings.length > 0) {
      lines.push('');
      lines.push(`⚠️ Avisos (${warnings.length}):`);
      for (const s of warnings.slice(0, 5)) {
        const label = SIGNAL_TYPE_LABEL[s.signal_type] ?? s.signal_type;
        const camp = (s.payload?.campaign_name as string | undefined) ?? '';
        lines.push(`• ${label}${camp ? ` — ${camp}` : ''}`);
      }
      if (warnings.length > 5) lines.push(`• ...e mais ${warnings.length - 5}`);
    }

    lines.push('');
    lines.push('Veja todos os detalhes em /signals na plataforma.');
    return lines.join('\n');
  }

  // ────────────────────────────────────────────
  // Cred lookup (cacheia em memória — TTL 60s)
  // ────────────────────────────────────────────

  private credCache = new Map<string, { has: boolean; expiresAt: number }>();
  private static readonly CRED_CACHE_TTL_MS = 60_000;

  private async orgHasLlmCred(orgId: string): Promise<boolean> {
    const cached = this.credCache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) return cached.has;

    const { data } = await this.supabase.adminClient
      .from('org_llm_credentials')
      .select('org_id')
      .eq('org_id', orgId)
      .maybeSingle();

    // Se ANTHROPIC_API_KEY env existe, também conta como "tem LLM"
    // (LlmService cai no fallback automaticamente)
    const has = !!data || !!process.env.ANTHROPIC_API_KEY;
    this.credCache.set(orgId, {
      has,
      expiresAt: Date.now() + AlertMessageFormatter.CRED_CACHE_TTL_MS,
    });
    return has;
  }
}
