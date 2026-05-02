/**
 * e-Click Active — workers entry point
 *
 * Hospeda jobs assíncronos do CRM:
 *  - BaileysManager: sessões WhatsApp Web (canal whatsapp_free)
 *  - [futuro] particionamento mensal de messages/ai_interactions
 *  - [futuro] cálculo de lead_scores periódico
 *  - [futuro] snapshots diários funnel_analytics / agent_performance
 *  - [futuro] execução de automations time_based
 */

import 'dotenv/config';
import { BaileysManager } from './whatsapp/baileys.manager.js';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[workers ${new Date().toISOString()}]`, ...args);
}

async function main(): Promise<void> {
  log('booting...');

  const manager = new BaileysManager();
  await manager.start();

  const heartbeat = setInterval(() => {
    log('heartbeat');
  }, 60_000);

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      log(`received ${signal}, shutting down`);
      clearInterval(heartbeat);
      void manager.stop().finally(() => process.exit(0));
    });
  }

  log('ready');
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[workers] fatal:', err);
  process.exit(1);
});
