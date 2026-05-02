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
  ) {
    this.register(zapi);
    this.register(baileys);
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
        if (typeof wa?.wa_id === 'string') return wa.wa_id;
        // Fallback: telefone do contato (Z-API e Baileys aceitam internacional)
        if (typeof data.phone === 'string') {
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
}
