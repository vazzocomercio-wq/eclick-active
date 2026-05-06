/**
 * Roda query arbitrária no Supabase via PostgREST e imprime o JSON.
 *
 * Uso (3 modos):
 *   1) GET via tabela:    node scripts/query-saas.mjs from <tabela> "<query-string>"
 *      ex:                 node scripts/query-saas.mjs from organizations "name=ilike.*vazzo*&select=id,name"
 *   2) RPC:               node scripts/query-saas.mjs rpc <funcao> '<json-args>'
 *   3) DDL/UPDATE/INSERT: node scripts/query-saas.mjs sql "UPDATE ..."
 *      (usa _admin_exec_sql — não retorna rows)
 *
 * Lê env de apps/api/.env (mesma instância usada pelo Active/Bridge).
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
  const [mode, ...rest] = process.argv.slice(2);
  if (!mode) {
    console.error('Uso: node query-saas.mjs <from|rpc|sql> ...');
    process.exit(1);
  }
  const env = loadEnv();
  const baseHeaders = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  let res;
  if (mode === 'from') {
    const [table, qs] = rest;
    const url = `${env.SUPABASE_URL}/rest/v1/${table}${qs ? `?${qs}` : ''}`;
    res = await fetch(url, { method: 'GET', headers: baseHeaders });
  } else if (mode === 'rpc') {
    const [fn, jsonArgs] = rest;
    res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: baseHeaders,
      body: jsonArgs ?? '{}',
    });
  } else if (mode === 'sql') {
    const sql = rest.join(' ');
    res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/_admin_exec_sql`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({ sql }),
    });
  } else {
    console.error('Modo inválido — use from, rpc ou sql');
    process.exit(1);
  }

  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  console.log(JSON.stringify(parsed, null, 2));
  if (!res.ok) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
