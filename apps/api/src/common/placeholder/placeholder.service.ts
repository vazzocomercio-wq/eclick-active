import { Injectable, Logger } from '@nestjs/common';
import {
  resolvePlaceholders,
  type PlaceholderContext,
  type ResolveOptions,
} from '@eclick-active/shared';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Constrói `PlaceholderContext` consultando o DB e resolve placeholders
 * em strings de templates de mensagem, automações e emails.
 *
 * Uso típico:
 *   const ctx = await placeholders.buildContext({ orgId, dealId, contactId, userId });
 *   const out = placeholders.resolve(template, ctx);
 *
 * Best-effort: cada lookup tem catch interno; entidade não encontrada
 * vira null no contexto (placeholder respectivo não resolve, vira string vazia).
 */
@Injectable()
export class PlaceholderService {
  private readonly logger = new Logger(PlaceholderService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Wrapper sobre `resolvePlaceholders` do shared. */
  resolve(template: string, ctx: PlaceholderContext, options?: ResolveOptions): string {
    return resolvePlaceholders(template, ctx, options);
  }

  /**
   * Carrega deal + contato + empresa + agente em paralelo. Aceita ids
   * opcionais — só busca o que foi pedido.
   */
  async buildContext(input: {
    orgId: string;
    dealId?: string | null;
    contactId?: string | null;
    companyId?: string | null;
    userId?: string | null;
  }): Promise<PlaceholderContext> {
    const [deal, contact, company, agent] = await Promise.all([
      input.dealId ? this.fetchDeal(input.orgId, input.dealId) : Promise.resolve(null),
      input.contactId
        ? this.fetchContact(input.orgId, input.contactId)
        : Promise.resolve(null),
      input.companyId
        ? this.fetchCompany(input.orgId, input.companyId)
        : Promise.resolve(null),
      input.userId
        ? this.fetchAgent(input.orgId, input.userId)
        : Promise.resolve(null),
    ]);

    // Se temos deal mas não foi passado contactId, herda do deal
    if (!contact && deal && !input.contactId) {
      // Fetch tardio se houver contact_id no deal
      const dealContactId = (deal as unknown as { _contact_id?: string })._contact_id;
      if (dealContactId) {
        const c = await this.fetchContact(input.orgId, dealContactId);
        if (c) {
          return { deal, contato: c, empresa: company, agente: agent };
        }
      }
    }

    return {
      deal,
      contato: contact,
      empresa: company,
      agente: agent,
    };
  }

  // ──────────────────────────────────────────────────────────
  // Fetchers (best-effort)
  // ──────────────────────────────────────────────────────────

  private async fetchDeal(
    orgId: string,
    dealId: string,
  ): Promise<PlaceholderContext['deal']> {
    try {
      const { data } = await this.supabase.adminClient
        .from('deals')
        .select(
          `id, contact_id, title, value, deal_number, ai_score, ai_next_action,
           custom_fields,
           stage:pipeline_stages(name),
           assigned:org_members!deals_assigned_to_fkey(display_name)`,
        )
        .eq('org_id', orgId)
        .eq('id', dealId)
        .maybeSingle();
      if (!data) return null;
      const d = data as DealRow;
      const stage = Array.isArray(d.stage) ? d.stage[0] ?? null : d.stage;
      const agent = Array.isArray(d.assigned) ? d.assigned[0] ?? null : d.assigned;
      return {
        titulo: d.title,
        valor: d.value,
        stage: stage?.name ?? null,
        responsavel: agent?.display_name ?? null,
        numero: d.deal_number,
        ai_score: d.ai_score,
        ai_next_action: d.ai_next_action,
        custom_fields: d.custom_fields,
        // marker pra herdar contact_id
        _contact_id: d.contact_id,
      } as PlaceholderContext['deal'];
    } catch (err) {
      this.logger.warn(`fetchDeal failed: ${String(err)}`);
      return null;
    }
  }

  private async fetchContact(
    orgId: string,
    contactId: string,
  ): Promise<PlaceholderContext['contato']> {
    try {
      const { data } = await this.supabase.adminClient
        .from('contacts')
        .select(
          'name, phone, email, temperature, ai_summary, custom_fields, company:companies(name)',
        )
        .eq('org_id', orgId)
        .eq('id', contactId)
        .maybeSingle();
      if (!data) return null;
      const c = data as ContactRow;
      const company = Array.isArray(c.company) ? c.company[0] ?? null : c.company;
      return {
        nome: c.name,
        telefone: c.phone,
        email: c.email,
        empresa: company?.name ?? null,
        temperatura: c.temperature,
        ai_summary: c.ai_summary,
        custom_fields: c.custom_fields,
      };
    } catch (err) {
      this.logger.warn(`fetchContact failed: ${String(err)}`);
      return null;
    }
  }

  private async fetchCompany(
    orgId: string,
    companyId: string,
  ): Promise<PlaceholderContext['empresa']> {
    try {
      const { data } = await this.supabase.adminClient
        .from('companies')
        .select('name, domain, custom_fields')
        .eq('org_id', orgId)
        .eq('id', companyId)
        .maybeSingle();
      if (!data) return null;
      const c = data as CompanyRow;
      return {
        nome: c.name,
        site: c.domain,
        custom_fields: c.custom_fields,
        // companies não têm phone/email no schema atual
        telefone: null,
        email: null,
      };
    } catch (err) {
      this.logger.warn(`fetchCompany failed: ${String(err)}`);
      return null;
    }
  }

  private async fetchAgent(
    orgId: string,
    userId: string,
  ): Promise<PlaceholderContext['agente']> {
    try {
      const { data } = await this.supabase.adminClient
        .from('org_members')
        .select('display_name, email')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!data) return null;
      const m = data as AgentRow;
      return {
        nome: m.display_name,
        email: m.email,
        telefone: null, // org_members não tem phone direto
      };
    } catch (err) {
      this.logger.warn(`fetchAgent failed: ${String(err)}`);
      return null;
    }
  }
}

// ──────────────────────────────────────────────────────────
// Row shapes (locais)
// ──────────────────────────────────────────────────────────

interface DealRow {
  id: string;
  contact_id: string | null;
  title: string;
  value: number | null;
  deal_number: number;
  ai_score: number;
  ai_next_action: string | null;
  custom_fields: Record<string, unknown>;
  stage: { name: string } | Array<{ name: string }> | null;
  assigned:
    | { display_name: string | null }
    | Array<{ display_name: string | null }>
    | null;
}

interface ContactRow {
  name: string | null;
  phone: string | null;
  email: string | null;
  temperature: 'cold' | 'warm' | 'hot' | 'very_hot' | null;
  ai_summary: string | null;
  custom_fields: Record<string, unknown>;
  company: { name: string | null } | Array<{ name: string | null }> | null;
}

interface CompanyRow {
  name: string;
  domain: string | null;
  custom_fields: Record<string, unknown>;
}

interface AgentRow {
  display_name: string | null;
  email: string | null;
}
