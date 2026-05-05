import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../../common/channels/channel-dispatcher.service';
import { ContactsService } from '../../contacts/contacts.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { AdIntegrationsService } from '../ad-integrations.service';

/**
 * Field do form do Meta — pode ser FULL_NAME, EMAIL, PHONE_NUMBER, custom.
 * Meta envia como array `field_data: [{name, values: ["..."]}, ...]`.
 */
interface MetaLeadField {
  name: string;
  values: string[];
}

export interface MetaLeadPayload {
  /** ID único do lead no Meta. Idempotente. */
  leadgen_id: string;
  /** ID do anúncio (link pra ad_campaigns via campaign_id) */
  ad_id?: string;
  /** ID do form_id (template do formulário) */
  form_id?: string;
  /** Page ID que veiculou o anúncio */
  page_id?: string;
  field_data: MetaLeadField[];
  /** ID da campanha — quando Meta inclui no payload expandido */
  campaign_id?: string;
  campaign_name?: string;
  /** UTC ISO timestamp do lead */
  created_time?: string;
}

interface ExtractedLead {
  phone: string | null;
  email: string | null;
  name: string | null;
  /** Campos extras pro raw_payload */
  custom: Record<string, string>;
}

/**
 * AdLeadsService — pipeline de processamento de leads vindos do Meta:
 *   1. Extrai phone/email/name do field_data
 *   2. Resolve campaign via ad_campaigns (best-effort)
 *   3. findOrCreate contact por phone (ou email se sem phone)
 *   4. Cria conversation no canal WhatsApp default da org
 *   5. Salva ad_lead row com contact_id/conversation_id
 *   6. Manda greeting cold outbound mencionando a campanha
 *   7. Adiciona tag LEAD_META_<campaign_slug> no contact
 *
 * Idempotente: se receber mesmo leadgen_id 2x, pula (UNIQUE constraint).
 *
 * Multi-tenant: TODA query inclui org_id.
 */
@Injectable()
export class AdLeadsService {
  private readonly logger = new Logger(AdLeadsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly contacts: ContactsService,
    private readonly conversations: ConversationsService,
    private readonly integrations: AdIntegrationsService,
  ) {}

  /**
   * Processa lead do Meta. Idempotente por leadgen_id global.
   * Retorna lead_id criado (ou null se já existia/foi descartado).
   */
  async processMetaLead(args: {
    orgId: string;
    integrationId: string;
    payload: MetaLeadPayload;
    hmacVerified: boolean;
  }): Promise<{ lead_id: string | null; created: boolean }> {
    // 1. Idempotência — se já temos esse leadgen_id, pula
    const existingId = await this.findExistingLeadId('meta', args.payload.leadgen_id);
    if (existingId) {
      this.logger.log(`[meta-lead] dedupe leadgen_id=${args.payload.leadgen_id} → ${existingId}`);
      return { lead_id: existingId, created: false };
    }

    // 2. Extrai campos do field_data
    const extracted = this.extractFields(args.payload.field_data);

    // 3. Resolve campaign (se ad_id veio, busca em ad_campaigns)
    let campaignId: string | null = null;
    let campaignName = args.payload.campaign_name ?? null;
    if (args.payload.ad_id || args.payload.campaign_id) {
      const externalId = args.payload.campaign_id ?? args.payload.ad_id;
      if (externalId) {
        const { data: c } = await this.supabase.adminClient
          .from('ad_campaigns')
          .select('id, name')
          .eq('org_id', args.orgId)
          .eq('external_id', externalId)
          .maybeSingle();
        if (c) {
          campaignId = (c as { id: string }).id;
          campaignName = (c as { name?: string }).name ?? campaignName;
        }
      }
    }

    // 4. Insert ad_lead row inicial (status: pending — sem contact ainda)
    const { data: leadRow, error: insErr } = await this.supabase.adminClient
      .from('ad_leads')
      .insert({
        org_id: args.orgId,
        platform: 'meta',
        external_lead_id: args.payload.leadgen_id,
        source_form_id: args.payload.form_id ?? null,
        source_ad_id: args.payload.ad_id ?? null,
        campaign_id: campaignId,
        phone: extracted.phone,
        email: extracted.email,
        name: extracted.name,
        raw_payload: args.payload as unknown as Record<string, unknown>,
        hmac_verified: args.hmacVerified,
      })
      .select('id')
      .single();

    if (insErr || !leadRow) {
      this.logger.error(`[meta-lead] insert falhou: ${insErr?.message}`);
      throw new InternalServerErrorException(insErr?.message ?? 'Falha ao salvar lead');
    }
    const leadId = (leadRow as { id: string }).id;

    // 5. Resolve contact (precisa de phone OU email pra criar)
    if (!extracted.phone && !extracted.email) {
      await this.markProcessed(leadId, 'sem phone nem email no form_data — sem como contatar');
      return { lead_id: leadId, created: true };
    }

    try {
      // findOrCreateByPhone se tem phone, senão findOrCreateByEmail
      const contact = extracted.phone
        ? await this.contacts.findOrCreateByPhone(args.orgId, extracted.phone, extracted.name ?? undefined)
        : await this.contacts.findOrCreateByEmail(args.orgId, extracted.email!, extracted.name ?? undefined);

      // 6. Resolve canal WhatsApp default da org
      const channelId = await this.resolveDefaultWhatsAppChannel(args.orgId);
      let conversationId: string | null = null;

      if (channelId && extracted.phone) {
        // 7. findOrCreate conversation
        const channel = await this.dispatcher.getChannel(args.orgId, channelId);
        const conv = await this.conversations.findOrCreate(
          args.orgId,
          contact.id,
          channelId,
          channel.channel_type,
        );
        conversationId = conv.id;

        // 8. Marca metadata.source_campaign + state pre-greeted (Concierge
        //    não dispara greeting próprio — vamos mandar customizado)
        await this.supabase.adminClient
          .from('conversations')
          .update({
            metadata: {
              ...((conv.metadata as Record<string, unknown> | null) ?? {}),
              source_campaign: {
                platform: 'meta',
                ad_id: args.payload.ad_id ?? null,
                campaign_id: campaignId,
                campaign_name: campaignName,
                form_id: args.payload.form_id ?? null,
                lead_id: leadId,
              },
              concierge_state: 'awaiting_response',
            },
          })
          .eq('id', conversationId)
          .eq('org_id', args.orgId);

        // 9. Manda greeting cold outbound. Falhas aqui NÃO derrubam o lead
        //    (já está salvo + contact criado). User pode reenviar manual.
        await this.sendInitialGreeting({
          orgId: args.orgId,
          channelId,
          contact,
          campaignName,
        }).catch((err: unknown) =>
          this.logger.warn(
            `[meta-lead] greeting falhou (lead ainda salvo): ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      } else if (!channelId) {
        this.logger.warn(`[meta-lead] org=${args.orgId} sem canal WhatsApp ativo`);
      }

      // 10. Atualiza ad_lead com contact_id/conversation_id + processed_at
      await this.supabase.adminClient
        .from('ad_leads')
        .update({
          contact_id: contact.id,
          conversation_id: conversationId,
          processed_at: new Date().toISOString(),
        })
        .eq('id', leadId);

      // 11. Tag automática do funil (best-effort)
      if (campaignName) {
        await this.applyLeadTag(args.orgId, contact.id, campaignName);
      }

      this.logger.log(
        `[meta-lead] ok org=${args.orgId} lead=${leadId} contact=${contact.id} conv=${conversationId ?? 'none'}`,
      );
      return { lead_id: leadId, created: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[meta-lead] processamento falhou lead=${leadId}: ${msg}`);
      await this.markProcessed(leadId, msg);
      return { lead_id: leadId, created: true };
    }
  }

  // ────────────────────────────────────────────
  // Privates
  // ────────────────────────────────────────────

  private extractFields(fieldData: MetaLeadField[]): ExtractedLead {
    const lower = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const out: ExtractedLead = {
      phone: null,
      email: null,
      name: null,
      custom: {},
    };
    for (const f of fieldData ?? []) {
      const value = (f.values ?? [])[0];
      if (!value) continue;
      const key = lower(f.name);
      if (key === 'phonenumber' || key === 'phone' || key === 'telefone' || key === 'celular') {
        out.phone = value.replace(/\D/g, '');
      } else if (key === 'email' || key === 'workemail' || key === 'emailaddress') {
        out.email = value.toLowerCase().trim();
      } else if (key === 'fullname' || key === 'name' || key === 'nome' || key === 'firstname') {
        out.name = value.trim();
      } else {
        out.custom[f.name] = value;
      }
    }
    return out;
  }

  private async findExistingLeadId(
    platform: 'meta' | 'google',
    externalLeadId: string,
  ): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('ad_leads')
      .select('id')
      .eq('platform', platform)
      .eq('external_lead_id', externalLeadId)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  private async resolveDefaultWhatsAppChannel(orgId: string): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('channels')
      .select('id')
      .eq('org_id', orgId)
      .in('channel_type', ['whatsapp', 'whatsapp_free'])
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1);
    return ((data ?? [])[0] as { id: string } | undefined)?.id ?? null;
  }

  private async sendInitialGreeting(args: {
    orgId: string;
    channelId: string;
    contact: { id: string; name: string | null };
    campaignName: string | null;
  }): Promise<void> {
    const firstName = args.contact.name?.trim().split(/\s+/)[0] ?? '';
    const namePart = firstName ? `${firstName}` : 'Olá';
    const campaignPart = args.campaignName ? ` no anúncio *${args.campaignName}*` : '';

    const body = `${namePart}! Vi que você se interessou${campaignPart}. 🙂

Em que posso te ajudar? Me conta um pouco sobre o que você está procurando.`;

    await this.dispatcher.send({
      org_id: args.orgId,
      channel_id: args.channelId,
      contact_id: args.contact.id,
      content_type: 'text',
      content: { body },
    });
  }

  /**
   * Aplica tag LEAD_META_<slug> no contact. Best-effort — falha aqui
   * não derruba o lead (já salvo).
   */
  private async applyLeadTag(orgId: string, contactId: string, campaignName: string): Promise<void> {
    const slug = campaignName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);
    const tag = `LEAD_META_${slug}`;
    try {
      const { data: contact } = await this.supabase.adminClient
        .from('contacts')
        .select('tags')
        .eq('id', contactId)
        .eq('org_id', orgId)
        .maybeSingle();
      const existing = (contact?.tags as string[] | null) ?? [];
      if (existing.includes(tag)) return;
      await this.supabase.adminClient
        .from('contacts')
        .update({ tags: [...existing, tag] })
        .eq('id', contactId)
        .eq('org_id', orgId);
    } catch (err) {
      this.logger.warn(
        `[meta-lead] applyLeadTag falhou contact=${contactId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async markProcessed(leadId: string, errorMessage?: string): Promise<void> {
    await this.supabase.adminClient
      .from('ad_leads')
      .update({
        processed_at: new Date().toISOString(),
        error_message: errorMessage?.slice(0, 500) ?? null,
      })
      .eq('id', leadId);
  }
}
