import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { AnthropicClient } from './anthropic.client';

export interface MissingField {
  /** Caminho do campo: 'contact.email', 'deal.value', 'contact.custom.cnpj', 'deal.custom.tipo_projeto' */
  path: string;
  /** Label legível: "Email", "Valor do negócio", "CNPJ" */
  label: string;
  /** Tipo de campo: text, email, phone, number, etc. */
  field_type: string;
}

export interface DetectedMissing {
  contact_id: string | null;
  deal_id: string;
  stage_name: string;
  missing: MissingField[];
}

export interface ExtractedFields {
  contact?: Record<string, string | number | boolean | null>;
  deal?: Record<string, string | number | boolean | null>;
}

const DEFAULT_LABELS: Record<string, string> = {
  name: 'Nome',
  email: 'Email',
  phone: 'Telefone',
  company_name: 'Empresa',
  value: 'Valor do negócio',
  expected_close_date: 'Data esperada de fechamento',
};

@Injectable()
export class DataCollectionService {
  private readonly logger = new Logger(DataCollectionService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly anthropic: AnthropicClient,
  ) {}

  // ──────────────────────────────────────────────────────────
  // detectMissingFields
  // ──────────────────────────────────────────────────────────

  async detectMissingFields(orgId: string, dealId: string): Promise<DetectedMissing | null> {
    const { data: deal, error } = await this.supabase.adminClient
      .from('deals')
      .select(
        'id, contact_id, value, expected_close_date, custom_fields, stage:pipeline_stages(id, name, required_contact_fields, required_deal_fields)',
      )
      .eq('org_id', orgId)
      .eq('id', dealId)
      .maybeSingle();
    if (error || !deal) return null;

    const stage = Array.isArray(
      (deal as { stage: unknown }).stage,
    )
      ? ((deal as { stage: Array<unknown> }).stage[0] as
          | {
              id: string;
              name: string;
              required_contact_fields: string[];
              required_deal_fields: string[];
            }
          | undefined)
      : ((deal as { stage: unknown }).stage as
          | {
              id: string;
              name: string;
              required_contact_fields: string[];
              required_deal_fields: string[];
            }
          | null
          | undefined);

    if (!stage) return null;
    const required_contact = stage.required_contact_fields ?? [];
    const required_deal = stage.required_deal_fields ?? [];

    if (required_contact.length === 0 && required_deal.length === 0) return null;

    const dealRow = deal as {
      id: string;
      contact_id: string | null;
      value: number | null;
      expected_close_date: string | null;
      custom_fields: Record<string, unknown>;
    };

    // Carrega contact (se houver)
    type ContactShape = {
      name: string | null;
      email: string | null;
      phone: string | null;
      company_name: string | null;
      custom_fields: Record<string, unknown>;
    };
    let contactRow: ContactShape | null = null;
    if (dealRow.contact_id) {
      const { data } = await this.supabase.adminClient
        .from('contacts')
        .select('name, email, phone, company_name, custom_fields')
        .eq('org_id', orgId)
        .eq('id', dealRow.contact_id)
        .maybeSingle();
      contactRow = (data as ContactShape | null) ?? null;
    }

    // Resolve custom field labels
    const customFieldLabels = await this.loadCustomFieldLabels(orgId, [
      ...required_contact,
      ...required_deal,
    ]);

    const missing: MissingField[] = [];

    // Contact fields
    for (const f of required_contact) {
      const isCustom = f.startsWith('custom:');
      if (isCustom) {
        const cfId = f.slice('custom:'.length);
        const cfData = (contactRow?.custom_fields ?? {}) as Record<string, unknown>;
        if (cfData[cfId] === undefined || cfData[cfId] === null || cfData[cfId] === '') {
          missing.push({
            path: `contact.custom.${cfId}`,
            label: customFieldLabels.get(cfId) ?? cfId,
            field_type: 'text',
          });
        }
      } else {
        const value = (contactRow as Record<string, unknown> | null)?.[f];
        if (value === null || value === undefined || value === '') {
          missing.push({
            path: `contact.${f}`,
            label: DEFAULT_LABELS[f] ?? f,
            field_type: f === 'email' ? 'email' : f === 'phone' ? 'phone' : 'text',
          });
        }
      }
    }

    // Deal fields
    for (const f of required_deal) {
      const isCustom = f.startsWith('custom:');
      if (isCustom) {
        const cfId = f.slice('custom:'.length);
        const cfData = (dealRow.custom_fields ?? {}) as Record<string, unknown>;
        if (cfData[cfId] === undefined || cfData[cfId] === null || cfData[cfId] === '') {
          missing.push({
            path: `deal.custom.${cfId}`,
            label: customFieldLabels.get(cfId) ?? cfId,
            field_type: 'text',
          });
        }
      } else {
        const value = (dealRow as Record<string, unknown>)[f];
        if (value === null || value === undefined || value === '' || value === 0) {
          missing.push({
            path: `deal.${f}`,
            label: DEFAULT_LABELS[f] ?? f,
            field_type: f === 'value' ? 'number' : f === 'expected_close_date' ? 'date' : 'text',
          });
        }
      }
    }

    if (missing.length === 0) return null;

    return {
      contact_id: dealRow.contact_id,
      deal_id: dealRow.id,
      stage_name: stage.name,
      missing,
    };
  }

  // ──────────────────────────────────────────────────────────
  // generateCollectionMessage
  // ──────────────────────────────────────────────────────────

  async generateCollectionMessage(
    orgId: string,
    detected: DetectedMissing,
  ): Promise<string> {
    const fieldList = detected.missing.map((m) => `- ${m.label}`).join('\n');
    const userPrompt = `O cliente está na etapa "${detected.stage_name}" do funil. Precisamos coletar os seguintes dados que ainda faltam:

${fieldList}

Gere UMA pergunta natural em português brasileiro que comece a coletar o dado MAIS importante (geralmente nome > email > telefone > resto). Não peça tudo de uma vez. Seja educado, contextual e breve. Retorne APENAS a pergunta — sem prefixos, aspas ou meta-comentários.`;

    try {
      const { data } = await this.anthropic.complete<string>({
        interaction_type: 'suggest_response',
        org_id: orgId,
        system:
          'Você é um assistente comercial brasileiro. Sua tarefa é gerar perguntas naturais para coletar dados de leads sem soar invasivo. Foque em UMA pergunta por vez. Texto plano, sem aspas, sem prefixos.',
        user: userPrompt,
        max_tokens: 150,
      });
      return data.trim().replace(/^["']|["']$/g, '');
    } catch (err) {
      this.logger.warn(
        `generateCollectionMessage fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Fallback se IA falhar
      const first = detected.missing[0];
      return first
        ? `Pra prosseguir, poderia me passar seu ${first.label.toLowerCase()}?`
        : 'Pra prosseguir, preciso de mais alguns dados.';
    }
  }

  // ──────────────────────────────────────────────────────────
  // processResponseForFields — extrai dados da resposta do cliente
  // ──────────────────────────────────────────────────────────

  async processResponseForFields(
    orgId: string,
    messageText: string,
    detected: DetectedMissing,
  ): Promise<ExtractedFields> {
    if (!messageText.trim()) return {};

    const fieldList = detected.missing
      .map((m) => `${m.path} (${m.label}, tipo ${m.field_type})`)
      .join(', ');

    const schema = {
      type: 'object',
      properties: {
        contact: {
          type: 'object',
          additionalProperties: true,
        },
        deal: {
          type: 'object',
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    };

    const userPrompt = `O cliente respondeu: "${messageText}"

Extraia APENAS os seguintes dados se presentes na mensagem (use null pra não-encontrados):
${fieldList}

Retorne JSON válido com chaves "contact" e "deal", cada uma com os campos detectados (nome, email, phone — ou caminhos custom). Se nada foi detectado, retorne {"contact":{},"deal":{}}.`;

    try {
      const { data } = await this.anthropic.complete<ExtractedFields>({
        interaction_type: 'classify_intent',
        org_id: orgId,
        system:
          'Você é um extrator de dados estruturados de mensagens de chat em português. Retorne APENAS JSON válido sem texto adicional. Nunca invente dados — só extraia o que está EXPLÍCITO na mensagem.',
        user: userPrompt,
        schema,
        max_tokens: 256,
      });
      return data ?? {};
    } catch (err) {
      this.logger.warn(
        `processResponseForFields failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {};
    }
  }

  // ──────────────────────────────────────────────────────────
  // applyExtractedFields — persiste o que IA extraiu
  // ──────────────────────────────────────────────────────────

  async applyExtractedFields(
    orgId: string,
    detected: DetectedMissing,
    extracted: ExtractedFields,
  ): Promise<{ updated_contact: string[]; updated_deal: string[] }> {
    const updatedContact: string[] = [];
    const updatedDeal: string[] = [];

    if (extracted.contact && detected.contact_id) {
      const updates: Record<string, unknown> = {};
      const customUpdates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(extracted.contact)) {
        if (v === null || v === undefined || v === '') continue;
        if (k.startsWith('contact.custom.')) {
          customUpdates[k.replace('contact.custom.', '')] = v;
        } else if (k.startsWith('contact.')) {
          updates[k.replace('contact.', '')] = v;
        } else if (['name', 'email', 'phone', 'company_name'].includes(k)) {
          updates[k] = v;
        }
      }

      if (Object.keys(customUpdates).length > 0) {
        // Merge no jsonb existente
        const { data } = await this.supabase.adminClient
          .from('contacts')
          .select('custom_fields')
          .eq('org_id', orgId)
          .eq('id', detected.contact_id)
          .maybeSingle();
        const current = ((data as { custom_fields: Record<string, unknown> } | null)?.custom_fields ?? {}) as Record<string, unknown>;
        updates.custom_fields = { ...current, ...customUpdates };
      }

      if (Object.keys(updates).length > 0) {
        const { error } = await this.supabase.adminClient
          .from('contacts')
          .update(updates)
          .eq('org_id', orgId)
          .eq('id', detected.contact_id);
        if (error) {
          this.logger.warn(`applyExtractedFields contact update failed: ${error.message}`);
        } else {
          updatedContact.push(...Object.keys(updates).filter((k) => k !== 'custom_fields'));
          if (Object.keys(customUpdates).length > 0) updatedContact.push('custom_fields');

          // Timeline
          await this.supabase.adminClient
            .from('contact_timeline')
            .insert({
              org_id: orgId,
              contact_id: detected.contact_id,
              event_type: 'ai_data_collected',
              title: 'IA coletou dados na conversa',
              description: `Campos atualizados: ${updatedContact.join(', ')}`,
              metadata: { updates, source: 'data_collection' },
            })
            .then(() => {})
            .then(undefined, () => {});
        }
      }
    }

    if (extracted.deal) {
      const updates: Record<string, unknown> = {};
      const customUpdates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(extracted.deal)) {
        if (v === null || v === undefined || v === '') continue;
        if (k.startsWith('deal.custom.')) {
          customUpdates[k.replace('deal.custom.', '')] = v;
        } else if (k.startsWith('deal.')) {
          updates[k.replace('deal.', '')] = v;
        } else if (['value', 'expected_close_date'].includes(k)) {
          updates[k] = v;
        }
      }

      if (Object.keys(customUpdates).length > 0) {
        const { data } = await this.supabase.adminClient
          .from('deals')
          .select('custom_fields')
          .eq('org_id', orgId)
          .eq('id', detected.deal_id)
          .maybeSingle();
        const current = ((data as { custom_fields: Record<string, unknown> } | null)?.custom_fields ?? {}) as Record<string, unknown>;
        updates.custom_fields = { ...current, ...customUpdates };
      }

      if (Object.keys(updates).length > 0) {
        const { error } = await this.supabase.adminClient
          .from('deals')
          .update(updates)
          .eq('org_id', orgId)
          .eq('id', detected.deal_id);
        if (error) {
          this.logger.warn(`applyExtractedFields deal update failed: ${error.message}`);
        } else {
          updatedDeal.push(...Object.keys(updates));
        }
      }
    }

    return { updated_contact: updatedContact, updated_deal: updatedDeal };
  }

  // ──────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────

  /** Resolve labels de custom fields a partir de IDs ou nomes "custom:xxx" */
  private async loadCustomFieldLabels(
    orgId: string,
    requirements: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = requirements
      .filter((f) => f.startsWith('custom:'))
      .map((f) => f.slice('custom:'.length));
    if (ids.length === 0) return out;

    const { data } = await this.supabase.adminClient
      .from('custom_field_definitions')
      .select('id, name')
      .eq('org_id', orgId)
      .in('id', ids);
    for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
      out.set(row.id, row.name);
    }
    return out;
  }
}
