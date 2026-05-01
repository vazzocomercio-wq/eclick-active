import { createBrowserClient } from '@supabase/ssr';

/**
 * Cria um cliente Supabase pra uso em client components.
 *
 * **Importante**: chamar `createClient()` múltiplas vezes não causa
 * problemas — o `@supabase/ssr` usa cookies como storage, então todas
 * as instâncias compartilham a mesma sessão automaticamente.
 *
 * Pra middleware / route handlers / RSC usar `lib/supabase/middleware.ts`
 * (createServerClient).
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY são obrigatórias',
    );
  }
  return createBrowserClient(url, anonKey);
}
