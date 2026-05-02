/**
 * Resolve a lista de origens permitidas pra CORS.
 *
 * Ordem de precedência:
 *   1. CORS_ORIGINS — env var, lista separada por vírgula. Se setado,
 *      usa exatamente o que veio (override total).
 *   2. WEB_ORIGIN — legado/dev. Se setado, INCLUI esse origin junto com
 *      os defaults de produção.
 *   3. Defaults — localhost:3000 + active.eclick.app.br + www.
 *
 * Usa em main.ts (REST CORS) e em EventsGateway (Socket.IO CORS).
 */
const PRODUCTION_ORIGINS = [
  'https://active.eclick.app.br',
  'https://www.active.eclick.app.br',
];

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

export function resolveCorsOrigins(): string[] {
  const explicit = process.env.CORS_ORIGINS;
  if (explicit && explicit.trim()) {
    return explicit
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const fallback = new Set<string>([...DEV_ORIGINS, ...PRODUCTION_ORIGINS]);
  const webOrigin = process.env.WEB_ORIGIN;
  if (webOrigin) fallback.add(webOrigin);
  return Array.from(fallback);
}
