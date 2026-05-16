import { Injectable, Logger } from '@nestjs/common';

/**
 * F5 (sessão 2026-05-14) — Callback reverso Active → SaaS.
 *
 * Quando uma task com `metadata.source === 'saas_cadastro'` fica completed,
 * notificamos o SaaS pra ele:
 *   - marcar product_operator_assignments.status = 'completed'
 *   - re-avaliar completeness do produto
 *   - remover tag 'cadastro_pendente' se ficou ok
 *
 * Auth via shared secret (mesma env usada no automation-bridge, porém invertida:
 * Active possui ACTIVE_CALLBACK_SECRET ou ACTIVE_AUTOMATION_BRIDGE_SECRET).
 *
 * Fire-and-forget: falhas não bloqueiam o complete da task no Active. O cron
 * diário do SaaS reconcilia se o callback nunca chegou.
 */

interface CadastroCallbackInput {
  task_id: string;
}

interface CadastroDealCallbackInput {
  deal_id: string;
  outcome: 'won' | 'lost' | 'in_progress';
}

@Injectable()
export class SaasCallbackClient {
  private readonly log = new Logger(SaasCallbackClient.name);

  isConfigured(): boolean {
    return Boolean(
      process.env.SAAS_CALLBACK_URL && (
        process.env.ACTIVE_CALLBACK_SECRET ||
        process.env.ACTIVE_AUTOMATION_BRIDGE_SECRET
      ),
    );
  }

  /**
   * Dispara POST /products/cadastro-callback no SaaS. Fire-and-forget — não
   * aguarda + nunca lança erro pra cima.
   */
  async notifyTaskCompleted(taskId: string, source: string): Promise<void> {
    if (source !== 'saas_cadastro') return; // não é callback nosso, ignora
    if (!this.isConfigured()) {
      this.log.warn(`[saas-callback] env não configurada — skip task=${taskId}`);
      return;
    }
    const url = (process.env.SAAS_CALLBACK_URL ?? '').replace(/\/+$/, '');
    const secret = process.env.ACTIVE_CALLBACK_SECRET ?? process.env.ACTIVE_AUTOMATION_BRIDGE_SECRET ?? '';

    void (async () => {
      try {
        const res = await fetch(`${url}/products/cadastro-callback`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ task_id: taskId, secret } satisfies CadastroCallbackInput & { secret: string }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          this.log.warn(`[saas-callback] HTTP ${res.status}: ${body.slice(0, 200)}`);
        } else {
          this.log.log(`[saas-callback] task=${taskId} OK`);
        }
      } catch (e) {
        this.log.warn(`[saas-callback] task=${taskId} falha: ${(e as Error).message}`);
      }
    })();
  }

  /**
   * Dispara POST /products/cadastro-deal-callback no SaaS quando o estado de
   * um deal de cadastro muda (Ganho/Perdido/Em andamento).
   *
   * Necessário porque mover o card no kanban não completa as tasks vinculadas
   * (e "Perdido" não tem cascata nenhuma), então o `notifyTaskCompleted` nunca
   * dispararia e o assignment no SaaS ficaria dessincronizado.
   *
   * `cardKind` vem de `deal.custom_fields.card_kind` — só dispara quando é
   * 'product_cadastro' (o campo `source` não serve: o bridge sobrescreve pra
   * 'saas:ml-campaigns'). Fire-and-forget, mesmo padrão do task callback.
   */
  async notifyDealState(
    dealId: string,
    outcome: 'won' | 'lost' | 'in_progress',
    cardKind: string,
  ): Promise<void> {
    if (cardKind !== 'product_cadastro') return; // não é deal de cadastro, ignora
    if (!this.isConfigured()) {
      this.log.warn(`[saas-callback] env não configurada — skip deal=${dealId}`);
      return;
    }
    const url = (process.env.SAAS_CALLBACK_URL ?? '').replace(/\/+$/, '');
    const secret = process.env.ACTIVE_CALLBACK_SECRET ?? process.env.ACTIVE_AUTOMATION_BRIDGE_SECRET ?? '';

    void (async () => {
      try {
        const res = await fetch(`${url}/products/cadastro-deal-callback`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ deal_id: dealId, outcome, secret } satisfies CadastroDealCallbackInput & { secret: string }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          this.log.warn(`[saas-callback] deal HTTP ${res.status}: ${body.slice(0, 200)}`);
        } else {
          this.log.log(`[saas-callback] deal=${dealId} → ${outcome} OK`);
        }
      } catch (e) {
        this.log.warn(`[saas-callback] deal=${dealId} falha: ${(e as Error).message}`);
      }
    })();
  }
}
