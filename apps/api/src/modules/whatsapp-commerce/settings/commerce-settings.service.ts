import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type { WhatsAppCommerceSettings } from '../catalog/catalog.types';

/**
 * Service de configurações globais de WhatsApp Commerce por org.
 * Auto-cria settings com defaults se não existir.
 */
@Injectable()
export class CommerceSettingsService {
  constructor(private readonly supabase: SupabaseService) {}

  async get(orgId: string): Promise<WhatsAppCommerceSettings> {
    const existing = await this.find(orgId);
    if (existing) return existing;
    return this.create(orgId);
  }

  /**
   * Leitura SEM auto-criação — retorna null quando a org não tem row.
   * Usado pelo gate do SaleFlow (a row de settings é criada manualmente
   * pela org; código de fluxo nunca deve criá-la como efeito colateral).
   */
  async find(orgId: string): Promise<WhatsAppCommerceSettings | null> {
    const { data } = await this.supabase.adminClient
      .from('whatsapp_commerce_settings')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle();
    return (data as WhatsAppCommerceSettings | null) ?? null;
  }

  async create(orgId: string): Promise<WhatsAppCommerceSettings> {
    const { data, error } = await this.supabase.adminClient
      .from('whatsapp_commerce_settings')
      .insert({ org_id: orgId })
      .select('*')
      .single();
    if (error) throw error;
    return data as WhatsAppCommerceSettings;
  }

  async update(
    orgId: string,
    patch: Partial<WhatsAppCommerceSettings>,
  ): Promise<WhatsAppCommerceSettings> {
    // Garante que exista
    await this.get(orgId);
    const { data, error } = await this.supabase.adminClient
      .from('whatsapp_commerce_settings')
      .update(patch)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as WhatsAppCommerceSettings;
  }
}
