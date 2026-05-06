import { Injectable } from '@nestjs/common';
import { CommerceSettingsService } from '../../settings/commerce-settings.service';
import type { WhatsAppOrder, PaymentLink } from '../order.types';

interface PixManualConfig {
  provider: 'pix_manual';
  enabled: boolean;
  pix_key: string;
  recipient_name: string;
  city?: string;
}

/**
 * PIX manual: gera o BR Code (string EMV) que o cliente cola no app
 * do banco. Sem integração com PSP — perfeito pra MVP onde a org já
 * tem chave PIX no banco.
 *
 * Não recebe webhook automático — admin marca como pago manualmente
 * na UI ao confirmar via extrato.
 */
@Injectable()
export class PixManualProvider {
  readonly name = 'pix_manual' as const;

  constructor(private readonly settings: CommerceSettingsService) {}

  async isAvailable(orgId: string): Promise<boolean> {
    const cfg = await this.getConfig(orgId);
    return Boolean(cfg && cfg.enabled && cfg.pix_key);
  }

  async generateLink(order: WhatsAppOrder): Promise<PaymentLink> {
    const cfg = await this.getConfig(order.org_id);
    if (!cfg) {
      throw new Error('PIX manual não configurado pra esta org');
    }

    const brCode = this.buildBrCode({
      pix_key: cfg.pix_key,
      amount: order.total,
      recipient_name: cfg.recipient_name,
      city: cfg.city ?? 'BRASIL',
      txid: order.display_number.replace('-', '').slice(0, 25),
    });

    return {
      url: null,
      pix_copy_paste: brCode,
      provider: 'pix_manual',
    };
  }

  private async getConfig(orgId: string): Promise<PixManualConfig | null> {
    try {
      const settings = await this.settings.get(orgId);
      const providers =
        (settings.payment_providers as Array<Record<string, unknown>>) ?? [];
      const pix = providers.find(
        (p) => (p as { provider?: string }).provider === 'pix_manual',
      );
      if (!pix) return null;
      return pix as unknown as PixManualConfig;
    } catch {
      return null;
    }
  }

  /**
   * Gera o BR Code EMV pra PIX. Implementação minimalista do EMV-CRC16
   * suficiente pra QR estático com valor.
   *
   * Layout: id(2)+len(2)+value, todos string. Final: 6304+CRC16(payload).
   */
  private buildBrCode(args: {
    pix_key: string;
    amount: number;
    recipient_name: string;
    city: string;
    txid: string;
  }): string {
    const fmt = (id: string, value: string): string =>
      id + value.length.toString().padStart(2, '0') + value;

    // Merchant Account Information (id=26): GUI + chave
    const mai =
      fmt('00', 'br.gov.bcb.pix') + fmt('01', args.pix_key);
    const merchantAccount = fmt('26', mai);

    // Additional data (id=62): TXID
    const additional = fmt(
      '62',
      fmt('05', args.txid.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'),
    );

    const payload =
      fmt('00', '01') + // payload format indicator
      fmt('01', '12') + // point of init: dinâmico (recomendado pra valor único)
      merchantAccount +
      fmt('52', '0000') + // MCC
      fmt('53', '986') + // currency BRL
      fmt('54', args.amount.toFixed(2)) + // amount
      fmt('58', 'BR') + // country
      fmt('59', this.sanitize(args.recipient_name).slice(0, 25)) +
      fmt('60', this.sanitize(args.city).slice(0, 15)) +
      additional +
      '6304';

    const crc = this.crc16(payload);
    return payload + crc;
  }

  private sanitize(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9 ]/g, '')
      .toUpperCase();
  }

  private crc16(input: string): string {
    let crc = 0xffff;
    for (let i = 0; i < input.length; i += 1) {
      crc ^= input.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j += 1) {
        crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
}
