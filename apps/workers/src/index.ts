/**
 * e-Click Active — workers entry point
 *
 * Hospeda jobs assíncronos do CRM:
 *  - Particionamento mensal de messages/ai_interactions
 *  - Cálculo de lead_scores (recalculate periódico)
 *  - Snapshots diários em funnel_analytics e agent_performance
 *  - Execução de automations time_based
 *  - Limpeza/expiração de webhooks_logs
 */

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[workers ${new Date().toISOString()}]`, ...args);
}

async function main(): Promise<void> {
  log('booting...');

  // TODO: registrar jobs reais aqui
  const heartbeat = setInterval(() => {
    log('heartbeat');
  }, 30_000);

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      log(`received ${signal}, shutting down`);
      clearInterval(heartbeat);
      process.exit(0);
    });
  }

  log('ready');
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[workers] fatal:', err);
  process.exit(1);
});
