import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const ACTIVE_SCHEMA = 'active';

/**
 * Cliente "any-schema-aware". Os generics estritos do supabase-js fazem
 * `SupabaseClient<any, "active", ...>` e `SupabaseClient<any, "public", ...>`
 * serem incompatíveis. Como não temos Database codegen, simplificamos.
 */
type AnyClient = SupabaseClient<any, any, any, any, any>;

/**
 * Wrapper sobre o supabase-js. Expõe dois clientes:
 * - `adminClient`: service-role, ignora RLS. Use sempre filtrando por org_id manualmente.
 * - `authClient(jwt)`: cria um cliente por requisição autenticado com o JWT do usuário (RLS aplicada).
 *
 * Ambos vêm pré-configurados com `db.schema = 'active'`.
 */
@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private _admin?: AnyClient;

  onModuleInit(): void {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      this.logger.warn(
        'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente — queries vão falhar até as envs serem configuradas.',
      );
    } else {
      this.logger.log('SupabaseService initialized');
    }
  }

  /** Service-role client. Cuidado: ignora RLS — sempre filtre por org_id na query. */
  get adminClient(): AnyClient {
    if (this._admin) return this._admin;

    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    }
    this._admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: ACTIVE_SCHEMA },
    }) as AnyClient;
    return this._admin;
  }

  /** Cliente autenticado pelo JWT do usuário — RLS é aplicada. */
  authClient(jwt: string): AnyClient {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
    }
    return createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: ACTIVE_SCHEMA },
    }) as AnyClient;
  }

  /** Valida um JWT e retorna o usuário do auth.users. Retorna null se inválido. */
  async getUserFromJwt(jwt: string): Promise<{ id: string; email?: string } | null> {
    const { data, error } = await this.adminClient.auth.getUser(jwt);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email };
  }
}
