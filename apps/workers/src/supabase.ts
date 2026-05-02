import { createClient } from '@supabase/supabase-js';

// Schema 'active' não é o default do Supabase ('public'), então o tipo do
// client é parametrizado pelo schema. Usamos uma alias local pra simplificar.
type SupabaseAdminClient = ReturnType<typeof buildClient>;

function buildClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no apps/workers/.env',
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'active' },
  });
}

let _client: SupabaseAdminClient | null = null;

/**
 * Singleton do client Supabase com service_role apontado pro schema `active`.
 * O worker faz operações privilegiadas (insert direto em active.messages,
 * update em active.channels) que bypassam RLS.
 */
export function getSupabase(): SupabaseAdminClient {
  if (!_client) _client = buildClient();
  return _client;
}
