import { Injectable, Logger } from '@nestjs/common';
import type {
  Channel,
  Form,
  FormField,
  FormFieldMapping,
  FormSettings,
  FormSubmission,
  FormSubmissionSource,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationsService } from '../conversations/conversations.service';
import { EventsGateway } from '../../gateways/events.gateway';
import { ChannelDispatcherService } from '../../common/channels/channel-dispatcher.service';
import { AutoLeadService } from '../webhooks/auto-lead.service';

interface ProcessSubmissionInput {
  orgId: string;
  formId: string;
  data: Record<string, unknown>;
  source?: FormSubmissionSource;
  ipAddress?: string;
  userAgent?: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
    term?: string;
  };
}

interface ProcessResult {
  submission_id: string;
  contact_id: string | null;
  deal_id: string | null;
  agent_assigned: string | null;
  welcome_sent: boolean;
}

/**
 * Pipeline de processamento de submissão:
 *   1. Persiste form_submission (raw data + UTMs)
 *   2. Extrai campos de contato via FormField.mapping
 *   3. findOrCreateContact (por email > phone)
 *   4. Cria deal se settings.pipeline_id (ou auto_create_deal)
 *   5. Atribui agente (round_robin / specific)
 *   6. Cria task de follow-up
 *   7. Envia welcome message via WhatsApp se configurado
 *   8. Dispara auto-lead + automations + emite notification:new
 *   9. Marca processed=true
 */
@Injectable()
export class FormProcessorService {
  private readonly logger = new Logger(FormProcessorService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly contacts: ContactsService,
    private readonly conversations: ConversationsService,
    private readonly events: EventsGateway,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly autoLead: AutoLeadService,
  ) {}

  async processSubmission(form: Form, input: ProcessSubmissionInput): Promise<ProcessResult> {
    // 1. Persist submission
    const { data: subRow, error: subErr } = await this.supabase.adminClient
      .from('form_submissions')
      .insert({
        form_id: form.id,
        org_id: input.orgId,
        data: input.data,
        source: input.source ?? 'link',
        ip_address: input.ipAddress ?? null,
        user_agent: input.userAgent ?? null,
        utm_source: input.utm?.source ?? null,
        utm_medium: input.utm?.medium ?? null,
        utm_campaign: input.utm?.campaign ?? null,
        utm_content: input.utm?.content ?? null,
        utm_term: input.utm?.term ?? null,
      })
      .select('*')
      .single();
    if (subErr || !subRow) {
      throw new Error(`persistir submission falhou: ${subErr?.message}`);
    }
    const submission = subRow as FormSubmission;

    // 2. Extrai campos mapeados
    const mapped = this.extractMappedFields(form.fields as FormField[], input.data);
    const settings = form.settings as FormSettings;

    let contactId: string | null = null;
    let dealId: string | null = null;
    let agentAssigned: string | null = null;
    let welcomeSent = false;

    try {
      // 3. findOrCreateContact (por email primeiro, fallback phone)
      if (mapped.email || mapped.phone) {
        const contact = mapped.email
          ? await this.contacts.findOrCreateByEmail(input.orgId, mapped.email, mapped.name)
          : await this.contacts.findOrCreateByPhone(input.orgId, mapped.phone!, mapped.name);
        contactId = contact.id;

        // Enriquece dados se vieram no form
        const patch: Record<string, unknown> = {};
        if (mapped.name && !contact.name) patch.name = mapped.name;
        if (mapped.phone && !contact.phone) patch.phone = mapped.phone;
        if (mapped.email && !contact.email) patch.email = mapped.email;
        if (settings.auto_tags && settings.auto_tags.length > 0) {
          patch.tags = Array.from(
            new Set([...(contact.tags ?? []), ...settings.auto_tags]),
          );
        }
        if (Object.keys(patch).length > 0) {
          await this.contacts.update(input.orgId, contact.id, patch);
        }
      }

      // 4. Cria deal se configurado
      if (contactId && (settings.pipeline_id || settings.auto_create_deal)) {
        const dealResult = await this.createDealForSubmission(
          input.orgId,
          contactId,
          form,
          mapped,
        );
        dealId = dealResult.dealId;
        agentAssigned = dealResult.agentAssigned;
      }

      // 5. Cria task de follow-up
      if (contactId && agentAssigned) {
        const dueIn1h = new Date(Date.now() + 60 * 60_000).toISOString();
        await this.supabase.adminClient.from('tasks').insert({
          org_id: input.orgId,
          title: `Contatar lead: ${mapped.name ?? 'novo cliente'}`,
          description: `Lead via formulário "${form.name}". Dados: ${JSON.stringify(mapped, null, 2).slice(0, 500)}`,
          task_type: 'follow_up',
          priority: 'high',
          status: 'pending',
          assigned_to: agentAssigned,
          contact_id: contactId,
          deal_id: dealId,
          due_date: dueIn1h,
          created_by_ai: true,
          ai_context: 'Form submission',
        });
      }

      // 6. Welcome message via WhatsApp
      if (
        contactId &&
        settings.welcome_message &&
        settings.welcome_channel_id &&
        mapped.phone
      ) {
        try {
          await this.dispatcher.send({
            org_id: input.orgId,
            channel_id: settings.welcome_channel_id,
            contact_id: contactId,
            content_type: 'text',
            content: { body: this.interpolate(settings.welcome_message, mapped) } as never,
          });
          welcomeSent = true;
        } catch (err) {
          this.logger.warn(
            `welcome message falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // 7. Notificação interna pra agente
      this.events.emitToOrg(input.orgId, 'notification', {
        id: submission.id,
        type: 'form_submission',
        title: `Novo lead via formulário`,
        body: `${form.name}: ${mapped.name ?? mapped.email ?? mapped.phone ?? 'lead'}`,
        link: `/formularios/${form.id}/submissoes`,
        severity: 'info',
        created_at: new Date().toISOString(),
        org_id: input.orgId,
        user_id: agentAssigned,
        read: false,
        metadata: { form_id: form.id, submission_id: submission.id, contact_id: contactId },
      } as never);

      // 8. autoLead pipeline (cria deal default se não foi feito antes,
      // dispara automation triggers, etc.)
      if (contactId) {
        const conv = await this.findConversationForContact(input.orgId, contactId);
        if (conv) {
          void this.autoLead
            .handleNewContact({
              orgId: input.orgId,
              contactId,
              conversationId: conv.id,
            })
            .catch(() => {});
        }
      }

      // 9. Webhook externo (notifications.webhook_url)
      if (settings.notifications?.webhook_url) {
        void this.notifyExternalWebhook(settings.notifications.webhook_url, {
          form_id: form.id,
          form_name: form.name,
          submission_id: submission.id,
          contact_id: contactId,
          deal_id: dealId,
          data: input.data,
          submitted_at: submission.submitted_at,
        }).catch(() => {});
      }
    } catch (err) {
      this.logger.error(
        `processSubmission falhou (parcialmente): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Marca processed=true mesmo se houver erro parcial
    const result: ProcessResult = {
      submission_id: submission.id,
      contact_id: contactId,
      deal_id: dealId,
      agent_assigned: agentAssigned,
      welcome_sent: welcomeSent,
    };
    await this.supabase.adminClient
      .from('form_submissions')
      .update({
        processed: true,
        processing_result: result as unknown as Record<string, unknown>,
        contact_id: contactId,
        deal_id: dealId,
      })
      .eq('id', submission.id);

    return result;
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  private extractMappedFields(
    fields: FormField[],
    data: Record<string, unknown>,
  ): {
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    value?: number;
    notes?: string;
  } {
    const out: Record<FormFieldMapping, unknown> = {} as never;
    for (const f of fields) {
      if (!f.mapping || f.mapping === 'custom') continue;
      const v = data[f.id];
      if (v === undefined || v === null || v === '') continue;
      out[f.mapping] = v;
    }

    return {
      ...(typeof out.name === 'string' ? { name: out.name } : {}),
      ...(typeof out.email === 'string' ? { email: out.email } : {}),
      ...(typeof out.phone === 'string' ? { phone: this.sanitizePhone(out.phone) } : {}),
      ...(typeof out.company === 'string' ? { company: out.company } : {}),
      ...(typeof out.value !== 'undefined'
        ? { value: this.parseNumber(out.value) ?? undefined }
        : {}),
      ...(typeof out.notes === 'string' ? { notes: out.notes } : {}),
    };
  }

  private sanitizePhone(raw: string): string {
    // Remove tudo que não é dígito; mantém raw se já tiver prefixo
    return raw.replace(/\D/g, '');
  }

  private parseNumber(v: unknown): number | null {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v.replace(/[^\d.,-]/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  private async createDealForSubmission(
    orgId: string,
    contactId: string,
    form: Form,
    mapped: { name?: string; company?: string; value?: number; notes?: string },
  ): Promise<{ dealId: string | null; agentAssigned: string | null }> {
    const settings = form.settings as FormSettings;

    // Resolve pipeline + stage
    let pipelineId = settings.pipeline_id;
    let stageId = settings.stage_id;

    if (!pipelineId) {
      const { data: pipe } = await this.supabase.adminClient
        .from('pipelines')
        .select('id')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle();
      pipelineId = (pipe as { id: string } | null)?.id;
    }
    if (!pipelineId) return { dealId: null, agentAssigned: null };

    if (!stageId) {
      const { data: stage } = await this.supabase.adminClient
        .from('pipeline_stages')
        .select('id')
        .eq('org_id', orgId)
        .eq('pipeline_id', pipelineId)
        .eq('is_won', false)
        .eq('is_lost', false)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle();
      stageId = (stage as { id: string } | null)?.id;
    }
    if (!stageId) return { dealId: null, agentAssigned: null };

    // Resolve assignment
    const agentAssigned = await this.resolveAssignment(orgId, settings);

    // Build title via template
    const title = this.interpolate(
      settings.deal_title_template ?? `Lead via formulário — ${mapped.name ?? 'cliente'}`,
      mapped,
    );

    const { data, error } = await this.supabase.adminClient
      .from('deals')
      .insert({
        org_id: orgId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        contact_id: contactId,
        title,
        value: mapped.value ?? 0,
        currency: 'BRL',
        ...(agentAssigned ? { assigned_to: agentAssigned } : {}),
        ...(settings.auto_tags && settings.auto_tags.length > 0
          ? { tags: settings.auto_tags }
          : {}),
      })
      .select('id')
      .single();
    if (error || !data) {
      this.logger.warn(`Falha ao criar deal: ${error?.message}`);
      return { dealId: null, agentAssigned };
    }
    return { dealId: (data as { id: string }).id, agentAssigned };
  }

  private async resolveAssignment(
    orgId: string,
    settings: FormSettings,
  ): Promise<string | null> {
    if (settings.assignment_rule === 'specific' && settings.assigned_to) {
      return settings.assigned_to;
    }
    if (settings.assignment_rule === 'round_robin') {
      // round-robin baseado em created_at do último deal — pega o user_id do
      // membro com menos deals criados nos últimos 7 dias
      const since = new Date(Date.now() - 7 * 86400_000).toISOString();
      const { data } = await this.supabase.adminClient
        .from('deals')
        .select('assigned_to')
        .eq('org_id', orgId)
        .gte('created_at', since)
        .not('assigned_to', 'is', null);
      const counts = new Map<string, number>();
      for (const r of (data ?? []) as Array<{ assigned_to: string | null }>) {
        if (!r.assigned_to) continue;
        counts.set(r.assigned_to, (counts.get(r.assigned_to) ?? 0) + 1);
      }

      const { data: members } = await this.supabase.adminClient
        .from('org_members')
        .select('id')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .in('role', ['owner', 'admin', 'agent']);
      const memberIds = ((members ?? []) as Array<{ id: string }>).map((m) => m.id);
      if (memberIds.length === 0) return null;

      // Member com menos deals; tie-break = ordem da query
      memberIds.sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));
      return memberIds[0] ?? null;
    }
    return null;
  }

  private async findConversationForContact(
    orgId: string,
    contactId: string,
  ): Promise<{ id: string } | null> {
    const { data } = await this.supabase.adminClient
      .from('conversations')
      .select('id')
      .eq('org_id', orgId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null) ?? null;
  }

  private interpolate(template: string, vars: Record<string, unknown>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      const v = vars[key as string];
      return v !== undefined && v !== null ? String(v) : '';
    });
  }

  private async notifyExternalWebhook(url: string, payload: unknown): Promise<void> {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      this.logger.warn(
        `Webhook externo falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
