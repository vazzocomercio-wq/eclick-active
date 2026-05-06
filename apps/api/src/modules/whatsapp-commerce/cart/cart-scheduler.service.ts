import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { EventsGateway } from '../../../gateways/events.gateway';
import { AutomationsService } from '../../automations/automations.service';

const TICK_MS = 5 * 60 * 1000; // 5min — checa abandono
const EXPIRE_TICK_MS = 60 * 60 * 1000; // 1h — checa expiração
const STARTUP_DELAY_MS = 60 * 1000;

/**
 * Cron jobs do carrinho:
 *   1. Marca carts active com last_interaction_at > X min como abandoned.
 *      X vem de commerce_settings.cart_abandon_minutes (default 30).
 *   2. Marca carts active/abandoned com created_at > Y min como expired.
 *      Y vem de commerce_settings.cart_expiry_minutes (default 1440=24h).
 *
 * Emite evento `cart:abandoned` quando carrinho transita pra abandoned —
 * isso dispara automation de recovery (B5).
 */
@Injectable()
export class CartSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CartSchedulerService.name);
  private abandonTimer: NodeJS.Timeout | null = null;
  private expireTimer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly events: EventsGateway,
    private readonly automations: AutomationsService,
  ) {}

  onModuleInit(): void {
    if (process.env.WHATSAPP_CART_SCHEDULER_DISABLED === 'true') {
      this.log.warn('Cart scheduler desligado por env');
      return;
    }
    this.startupTimeout = setTimeout(() => {
      void this.runAbandonCheck();
      void this.runExpireCheck();
      this.abandonTimer = setInterval(() => void this.runAbandonCheck(), TICK_MS);
      this.expireTimer = setInterval(
        () => void this.runExpireCheck(),
        EXPIRE_TICK_MS,
      );
    }, STARTUP_DELAY_MS);
    this.log.log(
      `Cart scheduler armado — abandon ${TICK_MS / 1000}s, expire ${EXPIRE_TICK_MS / 1000 / 60}min`,
    );
  }

  onModuleDestroy(): void {
    if (this.abandonTimer) clearInterval(this.abandonTimer);
    if (this.expireTimer) clearInterval(this.expireTimer);
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
  }

  private async runAbandonCheck(): Promise<void> {
    try {
      // Pega settings de cada org pra usar threshold individual
      const { data: settings } = await this.supabase.adminClient
        .from('whatsapp_commerce_settings')
        .select('org_id, cart_abandon_minutes')
        .eq('enabled', true);
      const orgs =
        (settings ?? []) as Array<{ org_id: string; cart_abandon_minutes: number }>;

      for (const s of orgs) {
        const threshold = new Date(
          Date.now() - s.cart_abandon_minutes * 60 * 1000,
        ).toISOString();
        const { data: marked } = await this.supabase.adminClient
          .from('whatsapp_carts')
          .update({
            status: 'abandoned',
            abandoned_at: new Date().toISOString(),
          })
          .eq('org_id', s.org_id)
          .eq('status', 'active')
          .lt('last_interaction_at', threshold)
          .select('id, contact_id, conversation_id, items, total');

        for (const cart of (marked ?? []) as Array<{
          id: string;
          contact_id: string;
          conversation_id: string | null;
          items: Array<{ quantity?: number }> | null;
          total: number | null;
        }>) {
          try {
            this.events.emitToOrg(s.org_id, 'cart:abandoned', {
              cart_id: cart.id,
              contact_id: cart.contact_id,
            });
          } catch {
            /* best-effort */
          }
          // Dispara automation runner pra cart_abandoned
          void this.automations
            .checkTriggers({
              event: 'cart_abandoned',
              org_id: s.org_id,
              cart_id: cart.id,
              contact_id: cart.contact_id,
              conversation_id: cart.conversation_id,
              items_count: (cart.items ?? []).reduce(
                (acc, it) => acc + (it.quantity ?? 0),
                0,
              ),
              total: Number(cart.total ?? 0),
            })
            .catch((err) =>
              this.log.warn(
                `automations.checkTriggers cart_abandoned falhou: ${String(err)}`,
              ),
            );
        }

        if ((marked ?? []).length > 0) {
          this.log.log(
            `org ${s.org_id}: ${(marked ?? []).length} cart(s) → abandoned`,
          );
        }
      }
    } catch (err) {
      this.log.warn(`runAbandonCheck falhou: ${String(err)}`);
    }
  }

  private async runExpireCheck(): Promise<void> {
    try {
      const { data: settings } = await this.supabase.adminClient
        .from('whatsapp_commerce_settings')
        .select('org_id, cart_expiry_minutes')
        .eq('enabled', true);
      const orgs =
        (settings ?? []) as Array<{ org_id: string; cart_expiry_minutes: number }>;

      for (const s of orgs) {
        const threshold = new Date(
          Date.now() - s.cart_expiry_minutes * 60 * 1000,
        ).toISOString();
        const { data: expired } = await this.supabase.adminClient
          .from('whatsapp_carts')
          .update({ status: 'expired' })
          .eq('org_id', s.org_id)
          .in('status', ['active', 'abandoned'])
          .lt('created_at', threshold)
          .select('id');
        if ((expired ?? []).length > 0) {
          this.log.log(
            `org ${s.org_id}: ${(expired ?? []).length} cart(s) expirados`,
          );
        }
      }
    } catch (err) {
      this.log.warn(`runExpireCheck falhou: ${String(err)}`);
    }
  }
}
