/**
 * e-Click Active — workers entry point
 *
 * Hospeda jobs assíncronos do CRM:
 *  - BaileysManager: sessões WhatsApp Web (canal whatsapp_free)
 *  - InternalServer: HTTP server interno pra API pedir envio de mensagens
 *  - [futuro] particionamento mensal de messages/ai_interactions
 *  - [futuro] cálculo de lead_scores periódico
 *  - [futuro] snapshots diários funnel_analytics / agent_performance
 *  - [futuro] execução de automations time_based
 */

import 'dotenv/config';
import { BaileysManager } from './whatsapp/baileys.manager.js';
import { InternalServer } from './internal-server.js';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[workers ${new Date().toISOString()}]`, ...args);
}

async function main(): Promise<void> {
  log('booting...');

  const manager = new BaileysManager();
  await manager.start();

  // Internal HTTP server pra outbound (apps/api → worker)
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!internalKey) {
    log('AVISO: INTERNAL_API_KEY ausente — internal-server desabilitado');
  }
  const internalServer = internalKey
    ? new InternalServer(manager, {
        port: Number(process.env.WORKER_INTERNAL_PORT ?? 3030),
        secret: internalKey,
      })
    : null;
  if (internalServer) {
    await internalServer.start();
  }

  const heartbeat = setInterval(() => {
    log('heartbeat');
  }, 60_000);

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      log(`received ${signal}, shutting down`);
      clearInterval(heartbeat);
      void Promise.allSettled([
        manager.stop(),
        internalServer?.stop() ?? Promise.resolve(),
      ]).finally(() => process.exit(0));
    });
  }

  log('ready');
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[workers] fatal:', err);
  process.exit(1);
});
