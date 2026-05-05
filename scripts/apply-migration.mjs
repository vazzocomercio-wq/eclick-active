/**
 * Aplica uma migration SQL via PostgREST RPC `public._admin_exec_sql`.
 * Uso: node scripts/apply-migration.mjs <path/to/migration.sql>
 *
 * Precisa de SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY exportados ou em
 * apps/api/.env (este script lê esse arquivo direto).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadEnv() {
  const envPath = resolve(__dirname, '..', 'apps', 'api', '.env');
  const raw = readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return env;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node apply-migration.mjs <path/to/sql>');
    process.exit(1);
  }
  const sql = readFileSync(resolve(file), 'utf-8');
  const env = loadEnv();
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente');
    process.exit(1);
  }

  const res = await fetch(`${url}/rest/v1/rpc/_admin_exec_sql`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });
  const body = await res.json();
  if (body.ok) {
    console.log('OK ✓', file);
  } else {
    console.error('FAIL ✗', body);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
