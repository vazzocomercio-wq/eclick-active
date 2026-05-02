import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Channel,
  ChannelType,
  ChannelProvider,
  Json,
  MessageContentType,
  SendMessageResult,
} from '@eclick-active/shared';
import { SupabaseService } from '../supabase/supabase.service';
import { ZapiProvider } from './providers/zapi/zapi.provider';
import { BaileysProvider } from './providers/baileys/baileys.provider';
import { EmailProvider } from './providers/email/email.provider';

export interface DispatcherSendInput {
  org_id: string;
  channel_id: string;
  contact_id: string;
  content_type: MessageContentType;
  content: Json;
  reply_to_channel_message_id?: string;
}

@Injectable()
export class ChannelDispatcherService {
  private readonly logger = new Logger(ChannelDispatcherService.name);
  private readonly providers = new Map<ChannelType, ChannelProvider>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly zapi: ZapiProvider,
    private readonly baileys: BaileysProvider,
    private readonly email: EmailProvider,
  ) {
    this.register(zapi);
    this.register(baileys);
    this.register(email);
  }

  register(provider: ChannelProvider): void {
    this.providers.set(provider.channel_type, provider);
    this.logger.log(`Registered provider for channel_type=${provider.channel_type}`);
  }

  hasProvider(type: ChannelType): boolean {
    return this.providers.has(type);
  }

  getProvider(type: ChannelType): ChannelProvider {
    const p = this.providers.get(type);
    if (!p) throw new NotFoundException(`No provider registered for ${type}`);
    return p;
  }

  /**
   * Resolve canal + recipient e dispara `provider.sendMessage`. Lança
   * exceções concretas que o caller (`MessagesService`) traduz em
   * `status='failed'` na mensagem persistida.
   */
  async send(input: DispatcherSendInput): Promise<SendMessageResult> {
    const channel = await this.getChannel(input.org_id, input.channel_id);

    if (channel.status !== 'active') {
      throw new BadRequestException(
        `Channel ${channel.id} is not active (status=${channel.status})`,
      );
    }

    const provider = this.getProvider(channel.channel_type);

    const to = await this.resolveRecipient(
      input.org_id,
      input.contact_id,
      channel.channel_type,
    );
    if (!to) {
      throw new BadRequestException(
        `Contact ${input.contact_id} has no ${channel.channel_type} profile`,
      );
    }

    return provider.sendMessage({
      channel,
      to,
      content_type: input.content_type,
      content: input.content,
      reply_to_channel_message_id: input.reply_to_channel_message_id,
    });
  }

  // ──────────────────────────────────────────────────────────
  // Lookup helpers (usados pelo dispatcher e pelo webhook handler)
  // ──────────────────────────────────────────────────────────

  /** Busca um canal pertencente à org. */
  async getChannel(orgId: string, channelId: string): Promise<Channel> {
    const { data, error } = await this.supabase.adminClient
      .from('channels')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', channelId)
      .maybeSingle();

    if (error) throw new Error(`Failed to load channel: ${error.message}`);
    if (!data) throw new NotFoundException(`Channel ${channelId} not found`);
    return data as Channel;
  }

  /**
   * Encontra o canal ativo cuja `credentials.instanceId` bate com o passado.
   * Usado pelo webhook da Z-API pra resolver `instanceId → channel`.
   * Retorna null se nenhum canal corresponder.
   */
  async findChannelByZapiInstanceId(instanceId: string): Promise<Channel | null> {
    // Filtro em campo dentro de jsonb: usar -> com chave. PostgREST sintaxe:
    // credentials->>instanceId.eq.value
    const { data, error } = await this.supabase.adminClient
      .from('channels')
      .select('*')
      .eq('channel_type', 'whatsapp')
      .eq('status', 'active')
      .filter('credentials->>instanceId', 'eq', instanceId)
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.error(`findChannelByZapiInstanceId failed: ${error.message}`);
      return null;
    }
    return (data as Channel | null) ?? null;
  }

  /** Resolve o ID externo do destinatário (wa_id, ig_id, etc.). */
  private async resolveRecipient(
    orgId: string,
    contactId: string,
    channelType: ChannelType,
  ): Promise<string | null> {
    const { data, error } = await this.supabase.adminClient
      .from('contacts')
      .select('phone, email, channel_profiles')
      .eq('org_id', orgId)
      .eq('id', contactId)
      .maybeSingle();

    if (error || !data) return null;

    const profiles =
      (data.channel_profiles as Record<string, Record<string, unknown>>) ?? {};

    switch (channelType) {
      case 'whatsapp':
      case 'whatsapp_free': {
        const wa = profiles.whatsapp;
        // Identidade canônica do contato no Baileys: wa_jid (`...@s.whatsapp.net`
        // OU `...@lid`). Round-trip preserva o JID exato — sem isso, contatos
        // que vieram via @lid (não compartilharam telefone) viram contatos
        // novos a cada reply (criando uma thread aleatória no WhatsApp).
        if (typeof wa?.wa_jid === 'string') return wa.wa_jid;
        // Z-API legado / contatos antigos: wa_id (digits-only, formato Z-API).
        if (typeof wa?.wa_id === 'string') return wa.wa_id;
        // Último recurso: phone bruto. Pra Baileys, isso só funciona se
        // for telefone real conhecido pelo WhatsApp — contatos LID legados
        // (criados antes do fix) podem ter `phone` com dígitos do LID que
        // NÃO são telefone, e o envio vai pra um chat aleatório. Avisamos.
        if (typeof data.phone === 'string') {
          if (channelType === 'whatsapp_free' && this.looksLikeLidDigits(data.phone)) {
            this.logger.warn(
              `Contact ${contactId} sem wa_jid e phone "${data.phone}" parece LID — envio pode falhar/rotear errado. Aguardando próxima inbound pra backfill.`,
            );
          }
          return this.normalizePhone(data.phone);
        }
        return null;
      }
      case 'instagram':
        return typeof profiles.instagram?.ig_id === 'string'
          ? (profiles.instagram.ig_id as string)
          : null;
      case 'messenger':
        return typeof profiles.messenger?.psid === 'string'
          ? (profiles.messenger.psid as string)
          : null;
      case 'telegram':
        return typeof profiles.telegram?.user_id === 'string'
          ? (profiles.telegram.user_id as string)
          : null;
      case 'email':
        if (typeof profiles.email?.address === 'string') {
          return profiles.email.address as string;
        }
        return typeof data.email === 'string' ? data.email : null;
      default:
        return null;
    }
  }

  private normalizePhone(phone: string): string {
    // Remove tudo que não for dígito. Z-API espera "5571999999999".
    return phone.replace(/\D/g, '');
  }

  /**
   * Heurística pra detectar contatos legacy onde `phone` foi populado com
   * dígitos extraídos de um JID `@lid` (não é telefone real). Telefones
   * internacionais válidos têm 10–13 dígitos; LIDs costumam ter 14+ dígitos.
   */
  private looksLikeLidDigits(phone: string): boolean {
    const digits = phone.replace(/\D/g, '');
    return digits.length >= 14;
  }
}
